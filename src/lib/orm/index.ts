// Export main Orm class

// Export column utilities
export {
  boolean,
  Column,
  date,
  json,
  jsonb,
  number,
  string,
  uuid,
} from "./column/index.js";
export type {
  ColumnKind,
  ColumnMeta,
  ColumnOptions,
  ColumnValue,
  DefaultColumnMeta,
} from "./column/types.js";
export { Orm } from "./core/index.js";
// Export types from core
export type { OrmDialect, OrmOptions, TableClients } from "./core/types.js";

// Export dialect utilities (for advanced users)
export {
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
} from "./dialect/index.js";
export type {
  ColumnTypeMapping,
  Dialect,
  QueryFragment,
  QueryResult,
} from "./dialect/types.js";

// Export relation utilities
export { many, one } from "./relations/index.js";
export type {
  IncludeOptions,
  ManyRelation,
  OneRelation,
  Relation,
  WithIncluded,
} from "./relations/types.js";

// Export table utilities
export { Table, TableClient } from "./table/index.js";
export type {
  BooleanFilter,
  DateFilter,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  InferTableType,
  NumberFilter,
  StringFilter,
  WhereClause,
} from "./table/types.js";
