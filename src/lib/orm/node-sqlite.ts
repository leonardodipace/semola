import { AsyncLocalStorage } from "node:async_hooks";
import { mightThrow } from "../errors/index.js";
import { OrmError } from "./errors.js";
import { hasSqlStatement } from "./migrations/sql.js";
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

// One connection: queries issued while a transaction is open join that transaction.
export const fromNodeSqlite = (db: NodeSqliteDatabase): SqlClient => {
  const unsafe: SqlTransaction["unsafe"] = async (statement, params = []) => {
    // prepare() compiles only the first statement; sourceSQL is its text.
    const prepared = db.prepare(statement);
    const rest = statement.slice(prepared.sourceSQL.length);

    if (!hasSqlStatement(rest)) {
      // A leading object would be read as named params and shift the rest.
      const rows = prepared.all(NO_NAMED_PARAMS, ...params.map(toSqliteParam));

      // node:sqlite rows have a null prototype; Bun.SQL rows are plain objects.
      return rows.map((row) => ({ ...row }));
    }

    if (params.length > 0) {
      throw new OrmError("Several statements cannot share params");
    }

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
    let queuedSavepoints = 0;
    let running: SqlTransaction | undefined;
    let ended = false;

    // A savepoint closes with its parent: its queries would otherwise run
    // after the parent's COMMIT or ROLLBACK, outside any transaction.
    const isOpen = () => {
      if (ended) return false;

      return isParentOpen();
    };

    // Like Bun.SQL: a forgotten await must not write outside the transaction.
    // SQLite also ends it on its own (INSERT OR ROLLBACK, RAISE(ROLLBACK));
    // isTransaction exists from Node 22.16 and 24.
    const assertOpen = () => {
      if (!isOpen()) {
        throw new OrmError(
          "Cannot run a query after its transaction or savepoint ended",
        );
      }

      if (db.isTransaction === false) {
        throw new OrmError("SQLite rolled back the transaction");
      }
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
        // From inside a running savepoint, it runs through that one, which
        // waits for its own nested savepoints.
        const enclosing = enclosingSavepoint();

        if (enclosing) return enclosing.unsafe(statement, params);

        // Beside a savepoint, it would land inside it and be undone with it.
        if (queuedSavepoints > 0) await tail;

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

          // allSettled, not mightThrow: a callback may reject with a falsy
          // value. async: a callback that throws synchronously still rolls back.
          const [outcome] = await Promise.allSettled([
            savepointScope.run(scope, async () => run(child.tx)),
          ]);

          await child.finish();
          running = outer;

          if (outcome.status === "rejected") {
            await mightThrow(unsafe(`ROLLBACK TO ${name}`));
            await mightThrow(unsafe(`RELEASE ${name}`));
            throw outcome.reason;
          }

          await unsafe(`RELEASE ${name}`);

          return outcome.value;
        };

        // It nests there, queued behind its own siblings.
        const enclosing = enclosingSavepoint();

        if (enclosing) return enclosing.savepoint(baseName, run);

        const next = tail.then(runSavepoint);

        const settle = () => {
          queuedSavepoints -= 1;
        };

        queuedSavepoints += 1;
        tail = next.then(settle, settle);

        return next;
      },
    };

    // Savepoints the callback did not await must settle before RELEASE or
    // COMMIT; once this ends they can no longer write and roll back.
    const finish = async () => {
      ended = true;

      await tail;
    };

    return { tx, finish };
  };

  const runTransaction = async <T>(
    begin: string,
    run: SqlRunTransaction<T>,
  ) => {
    await unsafe(begin);

    const transaction = createTransaction();

    // allSettled, not mightThrow: a callback may reject with a falsy value.
    // async: a callback that throws synchronously still ends the transaction.
    const [outcome] = await Promise.allSettled([
      (async () => run(transaction.tx))(),
    ]);

    await transaction.finish();

    if (outcome.status === "rejected") {
      await mightThrow(unsafe("ROLLBACK"));
      throw outcome.reason;
    }

    // COMMIT can fail and leave the transaction open (deferred foreign keys).
    const [commitError] = await mightThrow(unsafe("COMMIT"));

    if (commitError) {
      await mightThrow(unsafe("ROLLBACK"));
      throw commitError;
    }

    return outcome.value;
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

      return transactionScope
        .run(scope, () => runTransaction(begin, run))
        .finally(() => {
          activeTransaction = undefined;
        });
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
