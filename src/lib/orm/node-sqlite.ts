import { AsyncLocalStorage } from "node:async_hooks";
import { mightThrow } from "../errors/index.js";
import { OrmError } from "./errors.js";
import { splitStatements } from "./migrations/sql.js";
import type {
  NodeSqliteDatabase,
  SqlClient,
  SqlRunTransaction,
  SqlTransaction,
} from "./types.js";

const toSqliteParam = (value: unknown) => {
  if (typeof value === "boolean") return Number(value);
  if (value === undefined) return null;

  return value;
};

const NO_NAMED_PARAMS = {};

// The savepoints the current async call chain runs inside.
const savepointScope = new AsyncLocalStorage<Set<SqlTransaction>>();

// The transactions the current async call chain was started inside.
const transactionScope = new AsyncLocalStorage<Set<object>>();

const quoteSavepoint = (name: string) => {
  return `"${name.replaceAll('"', '""')}"`;
};

const hasSeveralStatements = (statement: string) => {
  if (!statement.includes(";")) return false;

  return splitStatements(statement).length > 1;
};

// One connection: queries issued while a transaction is open join that transaction.
export const fromNodeSqlite = (db: NodeSqliteDatabase): SqlClient => {
  // node:sqlite rows have a null prototype; Bun.SQL rows are plain objects.
  const all = (statement: string, params: unknown[]) => {
    // A leading object would be read as named params and shift the rest.
    const rows = db
      .prepare(statement)
      .all(NO_NAMED_PARAMS, ...params.map(toSqliteParam));

    return rows.map((row) => ({ ...row }));
  };

  const unsafe: SqlTransaction["unsafe"] = async (statement, params = []) => {
    // prepare() silently drops everything after the first statement.
    if (!hasSeveralStatements(statement)) return all(statement, params);

    if (params.length > 0) {
      throw new OrmError("Several statements cannot share params");
    }

    // exec() keeps trigger bodies whole, which splitting on ";" would break.
    db.exec(statement);

    return [];
  };

  // Unique names, like Bun.SQL: a nested savepoint must not reuse its parent's name.
  let savepointCount = 0;

  // SQLite savepoints form one stack, so overlapping siblings would release or
  // roll back each other. Siblings queue on their parent. A savepoint opened
  // through a parent from inside its running savepoint is handed to that one.
  const createTransaction = (isParentOpen = () => true) => {
    let tail = Promise.resolve();
    let running: SqlTransaction | undefined;
    let ended = false;

    // A savepoint closes with its parent: its queries would otherwise run
    // after the parent's COMMIT or ROLLBACK, outside any transaction.
    const isOpen = () => {
      if (ended) return false;

      return isParentOpen();
    };

    // Like Bun.SQL: a forgotten await must not write outside the transaction.
    const assertOpen = () => {
      if (isOpen()) return;

      throw new OrmError(
        "Cannot run a query after its transaction or savepoint ended",
      );
    };

    // The running savepoint, when the caller is inside it.
    const enclosingSavepoint = () => {
      if (!running) return;
      if (!savepointScope.getStore()?.has(running)) return;

      return running;
    };

    const tx: SqlTransaction = {
      queuesSavepoints: true,
      unsafe: async (statement, params) => {
        assertOpen();

        return unsafe(statement, params);
      },
      savepoint: (baseName, run) => {
        const runSavepoint = async () => {
          // A queued sibling may start after the transaction ended.
          assertOpen();

          savepointCount += 1;

          const name = quoteSavepoint(`${baseName}_${savepointCount}`);

          await unsafe(`SAVEPOINT ${name}`);

          const child = createTransaction(isOpen);
          const scope = new Set(savepointScope.getStore());
          const outer = running;

          scope.add(child.tx);
          running = child.tx;

          const [error, result] = await mightThrow(
            // async: a callback that throws synchronously still rolls back.
            savepointScope.run(scope, async () => run(child.tx)),
          );

          child.end();
          running = outer;

          if (error) {
            await mightThrow(unsafe(`ROLLBACK TO ${name}`));
            await mightThrow(unsafe(`RELEASE ${name}`));
            throw error;
          }

          await unsafe(`RELEASE ${name}`);

          return result;
        };

        // It nests there, queued behind its own siblings.
        const enclosing = enclosingSavepoint();

        if (enclosing) return enclosing.savepoint(baseName, run);

        const next = tail.then(runSavepoint);

        tail = next.then(
          () => undefined,
          () => undefined,
        );

        return next;
      },
    };

    const end = () => {
      ended = true;
    };

    return { tx, end };
  };

  const runTransaction = async <T>(
    begin: string,
    run: SqlRunTransaction<T>,
  ) => {
    await unsafe(begin);

    const transaction = createTransaction();

    // async: a callback that throws synchronously still ends the transaction.
    const runCallback = async () => run(transaction.tx);

    const runAndCommit = async () => {
      const [runError, result] = await mightThrow(runCallback());

      transaction.end();

      if (runError) throw runError;

      // COMMIT can fail and leave the transaction open (deferred foreign keys).
      await unsafe("COMMIT");

      return result;
    };

    const [error, result] = await mightThrow(runAndCommit());

    if (error) {
      await mightThrow(unsafe("ROLLBACK"));
      throw error;
    }

    return result;
  };

  // One connection holds one transaction, so later ones wait, as in Bun.SQL.
  // A transaction started from inside another would wait forever; reject it.
  let beginTail = Promise.resolve();
  let activeTransaction: object | undefined;

  // Timers created inside a transaction keep its scope after it ends, so
  // only the transaction still running counts.
  const isInsideActiveTransaction = () => {
    if (!activeTransaction) return false;

    return transactionScope.getStore()?.has(activeTransaction) ?? false;
  };

  const queueTransaction = async <T>(
    begin: string,
    run: SqlRunTransaction<T>,
  ) => {
    if (isInsideActiveTransaction()) {
      throw new OrmError("cannot start a transaction within a transaction");
    }

    const start = async () => {
      const token = {};
      const scope = new Set(transactionScope.getStore());

      scope.add(token);
      activeTransaction = token;

      const [error, result] = await mightThrow(
        transactionScope.run(scope, () => runTransaction(begin, run)),
      );

      activeTransaction = undefined;

      if (error) throw error;

      return result;
    };

    const next = beginTail.then(start);

    beginTail = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  };

  return {
    queuesTransactions: true,
    unsafe,
    begin: async <T>(
      first: string | SqlRunTransaction<T>,
      second?: SqlRunTransaction<T>,
    ) => {
      if (typeof first !== "string") return queueTransaction("BEGIN", first);
      if (!second) throw new OrmError("Missing transaction callback");

      return queueTransaction(`BEGIN ${first}`, second);
    },
    close: async () => db.close(),
  };
};
