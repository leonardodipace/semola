import { buildSelectColumns, getPrimaryKeyColumn } from "../internal/table.js";
import type { Table } from "../table.js";
import type {
  ColDefs,
  FindManyInput,
  RelationDefs,
  TableRow,
} from "../types.js";
import { hydrateManyRelation } from "./hydrate/many.js";
import { hydrateOneRelation } from "./hydrate/one.js";
import type { HydratorContext } from "./hydrate/types.js";

export function createRelationHydrator<
  T extends ColDefs,
  TRels extends RelationDefs,
>(context: HydratorContext<T, TRels>) {
  const selectWhereIn = async (
    targetTable: Table<ColDefs>,
    sqlColumnName: string,
    values: unknown[],
  ) => {
    if (values.length === 0) {
      return [];
    }

    const columns = buildSelectColumns(context.sql, targetTable);
    const rows = await context.executeOrThrow(
      context.sql`SELECT ${columns} FROM ${context.sql(targetTable.tableName)} WHERE ${context.sql(targetTable.tableName)}.${context.sql(sqlColumnName)} IN ${context.sql(values)}`,
    );

    return context.normalizeRowsForTable(
      targetTable,
      rows as Record<string, unknown>[],
    );
  };

  return async (
    rows: TableRow<T>[],
    include: FindManyInput<T, TRels>["include"] | undefined,
  ) => {
    if (!include) {
      return rows;
    }

    const basePk = getPrimaryKeyColumn(context.table);

    if (!basePk) {
      return rows;
    }

    for (const [relationKey, enabled] of Object.entries(include)) {
      if (enabled !== true) {
        continue;
      }

      const relation = context.relations[relationKey as keyof TRels];

      if (!relation) {
        continue;
      }

      const targetTable = relation.table();

      if (relation.kind === "one") {
        await hydrateOneRelation({
          rows,
          relationKey,
          relationForeignKey: relation.foreignKey,
          table: context.table,
          targetTable,
          selectWhereIn,
        });

        continue;
      }

      await hydrateManyRelation({
        rows,
        relationKey,
        relationForeignKey: relation.foreignKey,
        table: context.table,
        targetTable,
        basePk,
        allRelations: context.allRelations,
        allTables: context.allTables,
        selectWhereIn,
      });
    }

    return rows;
  };
}
