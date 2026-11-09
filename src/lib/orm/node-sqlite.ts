import { mightThrow } from "../errors/index.js";
import { OrmError } from "./errors.js";
import { splitStatements } from "./migrations/sql.js";
import type {
  NodeSqliteDatabase,
  SqlClient,
  SqlRow,
  SqlRunTransaction,
  SqlTransaction,
} from "./types.js";

const toSqliteParam = (value: unknown) => {
  if (typeof value === "boolean") return Number(value);
  if (value === undefined) return null;

  return value;
};

// One connection: queries issued while a transaction is open join that transaction.
export const fromNodeSqlite = (db: NodeSqliteDatabase): SqlClient => {
  // node:sqlite rows have a null prototype; Bun.SQL rows are plain objects.
  const all = (statement: string, params: unknown[]) => {
    const rows = db.prepare(statement).all(...params.map(toSqliteParam));

    return rows.map((row) => ({ ...row }));
  };

  const unsafe: SqlTransaction["unsafe"] = async (statement, params = []) => {
    // prepare() silently drops everything after the first statement.
    let parts = [statement];

    if (statement.includes(";")) {
      parts = splitStatements(statement);
    }

    if (params.length > 0) {
      if (parts.length > 1) {
        throw new OrmError("Several statements cannot share params");
      }

      return all(statement, params);
    }

    let rows: SqlRow[] = [];

    for (const part of parts) {
      rows = all(part, []);
    }

    return rows;
  };

  // Unique names, like Bun.SQL: overlapping siblings must not release each other.
  let savepointCount = 0;

  const tx: SqlTransaction = {
    unsafe,
    savepoint: async (baseName, run) => {
      savepointCount += 1;

      const name = `${baseName}_${savepointCount}`;

      await unsafe(`SAVEPOINT ${name}`);

      const [error, result] = await mightThrow(run(tx));

      if (error) {
        await mightThrow(unsafe(`ROLLBACK TO ${name}`));
        await mightThrow(unsafe(`RELEASE ${name}`));
        throw error;
      }

      await unsafe(`RELEASE ${name}`);

      return result;
    },
  };

  const runTransaction = async <T>(
    begin: string,
    run: SqlRunTransaction<T>,
  ) => {
    await unsafe(begin);

    const runAndCommit = async () => {
      const result = await run(tx);

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
