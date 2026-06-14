import type { TableClient, TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";

export type IsolationLevel =
  | "ReadUncommitted"
  | "ReadCommitted"
  | "RepeatableRead"
  | "Serializable";

export type TransactionOptions = {
  isolationLevel?: IsolationLevel;
  timeout?: number;
  maxWait?: number;
};

export type TransactionCallback<T extends Record<string, Table>, R, TResult> = (
  tx: TransactionClient<T, R>,
) => Promise<TResult>;

export type TransactionClient<
  T extends Record<string, Table>,
  R = Record<string, unknown>,
> = {
  [TTableName in keyof T]: TableClient<T[TTableName], TableRelations, T, R>;
} & {
  $raw: Bun.SQL;
};

export type BatchOperation<_T extends Record<string, Table>> = {
  _type: "batch";
  _promise: () => Promise<unknown>;
};
