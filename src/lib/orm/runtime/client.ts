import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../table.js";
import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteBuilderInput,
  DeleteManyInput,
  DialectAdapter,
  FindFirstInput,
  FindManyInput,
  FindUniqueInput,
  InsertInput,
  RelationDefs,
  TableRow,
  TinyTableClient,
  UpdateBuilderInput,
  UpdateManyInput,
} from "../types.js";
import { mapFindInputToSelect } from "./builders.js";
import { createRuntimeDialectContext } from "./context.js";
import { getRuntimeDialect } from "./dialect/index.js";
import { executeOrThrow } from "./errors.js";
import { createRelationHydrator } from "./hydrate.js";
import { normalizeRows, normalizeRowsForTable } from "./rows.js";
import { toWhereInput } from "./utils.js";

export function createTableClient<
  T extends ColDefs,
  TRels extends RelationDefs,
>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: TRels,
  dialectAdapter: DialectAdapter,
  allTables: Record<string, Table<ColDefs>>,
  allRelations: Partial<Record<string, RelationDefs>>,
): TinyTableClient<T, TRels> {
  const supportsReturning = dialectAdapter.dialect !== "mysql";

  const normalizeCurrentRows = (rows: TableRow<T>[]) =>
    normalizeRows(dialectAdapter.dialect, table, rows);

  const normalizeTargetRows = (
    targetTable: Table<ColDefs>,
    rows: Record<string, unknown>[],
  ) => normalizeRowsForTable(dialectAdapter.dialect, targetTable, rows);

  const context = createRuntimeDialectContext({
    runner: sql,
    table,
    relations,
    dialectAdapter,
    supportsReturning,
    normalizeCurrentRows,
    executeOrThrow,
  });

  function insertQuery(
    input: InsertInput<T> & { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function insertQuery(input: InsertInput<T>): SQL.Query<unknown>;
  function insertQuery(input: InsertInput<T>) {
    if (input.returning === true) {
      return context.insertReturning({ ...input, returning: true });
    }

    return context.insert(input);
  }

  function updateQuery(
    input: UpdateBuilderInput<T> & { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function updateQuery(input: UpdateBuilderInput<T>): SQL.Query<unknown>;
  function updateQuery(input: UpdateBuilderInput<T>) {
    if (input.returning === true) {
      return context.updateReturning({ ...input, returning: true });
    }

    return context.update(input);
  }

  function deleteQuery(
    input: DeleteBuilderInput<T> & { returning: true },
  ): SQL.Query<TableRow<T>[]>;
  function deleteQuery(input: DeleteBuilderInput<T>): SQL.Query<unknown>;
  function deleteQuery(input: DeleteBuilderInput<T>) {
    if (input.returning === true) {
      return context.deleteReturning({ ...input, returning: true });
    }

    return context.deleteByWhere(input);
  }

  const hydrateIncludedRelations = createRelationHydrator({
    sql,
    table,
    relations,
    allTables,
    allRelations,
    normalizeRowsForTable: normalizeTargetRows,
    executeOrThrow,
  });

  const runtimeDialect = getRuntimeDialect<T, TRels>(dialectAdapter.dialect);

  return {
    select: context.select,

    async findMany(input?: FindManyInput<T, TRels>) {
      const rows = await context.selectRows(mapFindInputToSelect(input));
      return hydrateIncludedRelations(rows, input?.include);
    },

    async findFirst(input?: FindFirstInput<T, TRels>) {
      const rows = await context.selectRows({
        ...mapFindInputToSelect(input),
        limit: 1,
      });

      if (input?.include) {
        await hydrateIncludedRelations(rows, input.include);
      }

      return rows[0] ?? null;
    },

    async findUnique(input: FindUniqueInput<T>) {
      const rows = await context.selectRows({
        where: toWhereInput<T>(input.where) as FindManyInput<
          T,
          Record<never, never>
        >["where"],
        limit: 1,
      });
      return rows[0] ?? null;
    },

    insert: insertQuery,

    async create(input: CreateInput<T>) {
      return runtimeDialect.create(context, input);
    },

    async createMany(input: CreateManyInput<T>) {
      return runtimeDialect.createMany(context, input);
    },

    update: updateQuery,

    async updateMany(input: UpdateManyInput<T>) {
      return runtimeDialect.updateMany(context, input);
    },

    delete: deleteQuery,

    async deleteMany(input: DeleteManyInput<T>) {
      return runtimeDialect.deleteMany(context, input);
    },
  };
}
