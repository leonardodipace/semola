import type { Column } from "../column/types.js";
import type {
  CreateManyOptions,
  CreateOptions,
  CreateResult,
  DeleteManyOptions,
  DeleteOptions,
  DeleteResult,
  FindFirstOptions,
  FindFirstResult,
  FindManyOptions,
  FindManyResult,
  FindUniqueOptions,
  FindUniqueResult,
  TableInclude,
  TableRelations,
  TableRow,
  TableSelect,
  TableWhere,
  UpdateManyOptions,
  UpdateOptions,
  UpdateResult,
} from "../orm/types.js";
import type { Table } from "../table/types.js";

export type Adapter = "sqlite" | "postgres";

export type DistinctClause = {
  // Inserted after SELECT, e.g. `DISTINCT ON ("title")`. Empty when unused.
  selectPrefix: string;
  // GROUP BY column list when the dialect keys distinct that way. Empty otherwise.
  groupBy: string;
  // Postgres DISTINCT ON requires orderBy to start with the distinct columns.
  requiresOrderByPrefix: boolean;
};

export type DialectSpec = {
  name: Adapter;
  // SQLite: ignores index, returns `?`. Postgres: returns `$${index}`.
  formatPlaceholder: (index: number) => string;
  // Pagination for skip without take. SQLite: `LIMIT -1 OFFSET`. Postgres: `LIMIT ALL OFFSET`.
  // The builder appends the placeholder itself.
  unlimitedOffsetKeyword: string;
  // Builds a JSON object from key/value args inside include subqueries.
  // SQLite: `json_object`. Postgres: `jsonb_build_object`.
  jsonObjectFunctionName: string;
  // Aggregates per-row JSON objects into a JSON array for `hasMany` includes.
  // SQLite: `json_group_array`. Postgres: `jsonb_agg`.
  jsonArrayAggregateFunctionName: string;
  // COALESCE fallback when a `hasMany` subquery returns no rows.
  // SQLite: `'[]'`. Postgres: `'[]'::jsonb`.
  emptyJsonArrayLiteral: string;
  // Postgres: DISTINCT ON (columns). SQLite: GROUP BY columns.
  formatDistinct: (quotedColumns: string[]) => DistinctClause;
};

export type SqlFragment = {
  sql: string;
  params: unknown[];
};

export type LogicalWhereKey = "$and" | "$not" | "$or";

export type LogicalWhereJoinKey = Exclude<LogicalWhereKey, "$not">;

export type LogicalSqlOperator = "AND" | "NOT" | "OR";

export type LogicalJoinOperator = Exclude<LogicalSqlOperator, "NOT">;

export type LogicalNotOperator = Extract<LogicalSqlOperator, "NOT">;

export type CollectedLogicalWhere =
  | { nestedClauses: string[]; nestedParams: unknown[] }
  | string;

export type IncludeDescriptor = {
  name: string;
  type: "hasMany" | "hasOne";
  table: Table;
  nested?: IncludeDescriptor[];
};

export type IncludeClause = {
  sql: string;
  params: unknown[];
  descriptors: IncludeDescriptor[];
};

export type HasManyCandidate = {
  fk: Column;
  source: { sqlName: string };
};

export type HasOneCandidate = {
  localForeignKey: Column;
  target: { sqlName: string };
};

export type RelationQueryOptions = {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
  take?: number;
  skip?: number;
  select?: Record<string, boolean>;
  include?: TableInclude;
};

export type RelationSubqueryResult = {
  sql: string;
  params: unknown[];
  descriptor: IncludeDescriptor;
};

export type ReturningQuery = {
  statement: string;
  params: unknown[];
  includeDescriptors: IncludeDescriptor[];
};

export type Row = Record<string, unknown>;

export type HasOneWriteInput = { connect?: Row; disconnect?: true };

export type HasManyWriteInput = { connect?: Row[]; disconnect?: Row[] };

export type RelationWriteOptions<T extends Table, R extends TableRelations> = {
  data: object;
  select?: TableSelect<T>;
  include?: TableInclude<R>;
};

export type ParseIncludeRowsInput = {
  table: Table;
  rows: Array<Record<string, unknown>>;
  descriptors: IncludeDescriptor[];
};

export type CreateDialectInput<T extends Table, R extends TableRelations> = {
  spec: DialectSpec;
  table: T;
  relations: R;
  tableRelationsMap?: Map<Table, TableRelations>;
};

export type GetDialectInput<T extends Table, R extends TableRelations> = {
  adapter: Adapter;
  table: T;
  relations: R;
  tableRelationsMap?: Map<Table, TableRelations>;
};

export type BuildSetClausesInput<T extends Table> = {
  nextPlaceholder: () => string;
  table: T;
  data: Record<string, unknown>;
};

export type BuildWhereClauseInput<
  T extends Table,
  R extends TableRelations = Record<never, never>,
> = {
  nextPlaceholder: () => string;
  table: T;
  where?: TableWhere<T, R>;
  relations?: R;
  parentAlias?: string;
};

export type RelationFilterKey = "every" | "none" | "some";

export type ParsedRelationFilter = {
  key: RelationFilterKey;
  where: TableWhere<Table>;
};

export type ResolveHasOneForeignKeyColumnInput = {
  sourceTable: Table;
  relationTable: Table;
  relationForeignKey: string;
};

export type BuildIncludeClauseInput<
  T extends Table,
  R extends TableRelations,
> = {
  spec: DialectSpec;
  nextPlaceholder: () => string;
  table: T;
  parentAlias: string;
  relations: R;
  tableRelationsMap: Map<Table, TableRelations>;
  include?: TableInclude<R>;
};

export type BuildPaginationClauseInput = {
  spec: DialectSpec;
  nextPlaceholder: () => string;
  take?: number;
  skip?: number;
};

export type BuildSelectStatementInput = {
  tableName: string;
  columns: string;
  where: string;
  orderBy: string;
  pagination: string;
  distinctPrefix?: string;
  groupBy?: string;
};

export type QueryBuilderInput<T extends Table, R extends TableRelations> = {
  spec: DialectSpec;
  table: T;
  relations: R;
  tableRelationsMap?: Map<Table, TableRelations>;
};

export type QueryBuilderSelectInput<
  T extends Table,
  R extends TableRelations,
> = {
  where?: TableWhere<T, R>;
  select?: TableSelect<T>;
  include?: TableInclude<R>;
};

export type QueryBuilderReturningInput<
  T extends Table,
  R extends TableRelations,
> = {
  where: TableWhere<T, R>;
  select?: TableSelect<T>;
  include?: TableInclude<R>;
};

export type CoerceRelationItemsInput = {
  value: unknown;
  table: Table;
  nested: IncludeDescriptor[];
};

export type CoerceRowInput = {
  row: Record<string, unknown>;
  table: Table;
  descriptors: IncludeDescriptor[];
};

export type Dialect<
  T extends Table = Table,
  TRelations extends TableRelations = TableRelations,
> = {
  name: Adapter;
  findMany<const TOptions extends FindManyOptions<T, TRelations>>(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<Array<FindManyResult<T, TRelations, TOptions>>>;

  findFirst<const TOptions extends FindFirstOptions<T, TRelations>>(
    sql: Bun.SQL,
    options?: TOptions,
  ): Promise<FindFirstResult<T, TRelations, TOptions>>;

  findUnique<const TOptions extends FindUniqueOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<FindUniqueResult<T, TRelations, TOptions>>;

  create<const TOptions extends CreateOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<CreateResult<T, TRelations, TOptions>>;

  createMany(
    sql: Bun.SQL,
    options: CreateManyOptions<T>,
  ): Promise<Array<TableRow<T>>>;

  update<const TOptions extends UpdateOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<UpdateResult<T, TRelations, TOptions>>;

  updateMany(
    sql: Bun.SQL,
    options: UpdateManyOptions<T, TRelations>,
  ): Promise<Array<TableRow<T>>>;

  delete<const TOptions extends DeleteOptions<T, TRelations>>(
    sql: Bun.SQL,
    options: TOptions,
  ): Promise<DeleteResult<T, TRelations, TOptions>>;

  deleteMany(
    sql: Bun.SQL,
    options: DeleteManyOptions<T, TRelations>,
  ): Promise<Array<TableRow<T>>>;
};
