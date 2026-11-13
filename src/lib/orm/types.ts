export type SqlRow = Record<string, unknown>;

type SqlQueryable = {
  unsafe(statement: string, params?: unknown[]): Promise<Iterable<SqlRow>>;
};

export type SqlTransaction = SqlQueryable & {
  savepoint<T>(name: string, run: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  // Set when overlapping savepoints already wait for each other, so the ORM
  // does not queue them a second time (two queues can wait on each other).
  queuesSavepoints?: boolean;
};

export type SqlRunTransaction<T> = (tx: SqlTransaction) => Promise<T>;

// Bun.SQL and postgres.js 4 satisfy this as-is.
export type SqlClient = SqlQueryable & {
  begin<T>(run: SqlRunTransaction<T>): Promise<T>;
  begin<T>(mode: string, run: SqlRunTransaction<T>): Promise<T>;
  close(): Promise<void>;
  // Set when overlapping transactions already wait for each other and a
  // nested one rejects, so the ORM does not queue them a second time.
  queuesTransactions?: boolean;
};

export type Sql = SqlClient | SqlTransaction;

// Structural subsets of `DatabaseSync` and `StatementSync` from `node:sqlite`.
type NodeSqliteStatement = { all(...params: unknown[]): SqlRow[] };

export type NodeSqliteDatabase = {
  prepare(statement: string): NodeSqliteStatement;
  exec(statement: string): void;
  close(): void;
};
