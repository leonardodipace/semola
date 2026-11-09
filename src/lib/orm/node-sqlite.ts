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
  // roll back each other. Siblings queue on their parent, as in postgres.js;
  // each savepoint gets its own queue, so nesting does not wait on the parent.
  const createTransaction = () => {
    let tail = Promise.resolve();

    const tx: SqlTransaction = {
      unsafe,
      savepoint: (baseName, run) => {
        const runSavepoint = async () => {
          savepointCount += 1;

          const name = `${baseName}_${savepointCount}`;

          await unsafe(`SAVEPOINT ${name}`);

          const [error, result] = await mightThrow(run(createTransaction()));

          if (error) {
            await mightThrow(unsafe(`ROLLBACK TO ${name}`));
            await mightThrow(unsafe(`RELEASE ${name}`));
            throw error;
          }

          await unsafe(`RELEASE ${name}`);

          return result;
        };

        const next = tail.then(runSavepoint);

        tail = next.then(
          () => undefined,
          () => undefined,
        );

        return next;
      },
    };

    return tx;
  };

  const runTransaction = async <T>(
    begin: string,
    run: SqlRunTransaction<T>,
  ) => {
    await unsafe(begin);

    const runAndCommit = async () => {
      const result = await run(createTransaction());

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

  return {
    unsafe,
    begin: async <T>(
      first: string | SqlRunTransaction<T>,
      second?: SqlRunTransaction<T>,
    ) => {
      if (typeof first !== "string") return runTransaction("BEGIN", first);
      if (!second) throw new OrmError("Missing transaction callback");

      return runTransaction(`BEGIN ${first}`, second);
    },
    close: async () => db.close(),
  };
};
