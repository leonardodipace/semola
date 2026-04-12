import type { SQL, TransactionSQL } from "bun";
import type { Table } from "../table.js";
import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteManyInput,
  DialectAdapter,
  FindFirstInput,
  FindManyInput,
  FindUniqueInput,
  RelationDefs,
  TableRow,
  TinyTableClient,
  UpdateManyInput,
} from "../types.js";
import { mapFindInputToSelect } from "./builders.js";
import { createRuntimeDialect } from "./dialect/index.js";
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

  const dialect = createRuntimeDialect({
    dialect: dialectAdapter.dialect,
    sql,
    table,
    relations,
    dialectAdapter,
    supportsReturning,
    normalizeCurrentRows,
    executeOrThrow,
  });

  const hydrateIncludedRelations = createRelationHydrator({
    sql,
    table,
    relations,
    allTables,
    allRelations,
    normalizeRowsForTable: normalizeTargetRows,
    executeOrThrow,
  });

  return {
    select: dialect.select,

    async findMany(input?: FindManyInput<T, TRels>) {
      const rows = await dialect.selectRows(mapFindInputToSelect(input));
      return hydrateIncludedRelations(rows, input?.include);
    },

    async findFirst(input?: FindFirstInput<T, TRels>) {
      const rows = await dialect.selectRows({
        ...mapFindInputToSelect(input),
        limit: 1,
      });

      if (input?.include) {
        await hydrateIncludedRelations(rows, input.include);
      }

      return rows[0] ?? null;
    },

    async findUnique(input: FindUniqueInput<T>) {
      const rows = await dialect.selectRows({
        where: toWhereInput<T>(input.where) as FindManyInput<
          T,
          Record<never, never>
        >["where"],
        limit: 1,
      });
      return rows[0] ?? null;
    },

    insert: dialect.insert,

    async create(input: CreateInput<T>) {
      return dialect.create(input);
    },

    async createMany(input: CreateManyInput<T>) {
      return dialect.createMany(input);
    },

    update: dialect.update,

    async updateMany(input: UpdateManyInput<T>) {
      return dialect.updateMany(input);
    },

    delete: dialect.deleteByWhere,

    async deleteMany(input: DeleteManyInput<T>) {
      return dialect.deleteMany(input);
    },
  };
}
