import { getPrimaryKeyColumn } from "../../internal/table.js";
import type { ColDefs, RelationDefs } from "../../types.js";
import type { RuntimeDialect } from "./types.js";
import { expectSingleRow, mergeRows, toWhereInput } from "./utils.js";

export function createMysqlRuntimeDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
>(): RuntimeDialect<T, TRels> {
  return {
    async create(context, input) {
      const primaryKey = getPrimaryKeyColumn(context.table);

      const selectCreatedRow = async (whereData: Record<string, unknown>) => {
        const rows = await context.selectRows({
          where: toWhereInput<T>(whereData),
          limit: 1,
        });

        return expectSingleRow(rows, "Insert returned no rows");
      };

      const insertResult = await context.executeOrThrow(
        context.insert({ data: input.data }),
      );

      if (!primaryKey) {
        return selectCreatedRow(input.data);
      }

      const selectCreatedRowByPrimaryKey = async (value: unknown) => {
        const whereByPk: Record<string, unknown> = {};
        Reflect.set(whereByPk, primaryKey.jsKey, value);

        return selectCreatedRow(whereByPk);
      };

      const providedPkValue = Reflect.get(input.data, primaryKey.jsKey);

      if (providedPkValue !== null && providedPkValue !== undefined) {
        return selectCreatedRowByPrimaryKey(providedPkValue);
      }

      let insertedPkValue: unknown;

      if (typeof insertResult === "object" && insertResult !== null) {
        insertedPkValue = Reflect.get(insertResult, "lastInsertRowid");

        if (insertedPkValue === null || insertedPkValue === undefined) {
          insertedPkValue = Reflect.get(insertResult, "insertId");
        }
      }

      if (insertedPkValue === null || insertedPkValue === undefined) {
        throw new Error("Insert returned no primary key");
      }

      return selectCreatedRowByPrimaryKey(insertedPkValue);
    },

    async createMany(context, input) {
      if (input.data.length === 0) {
        return { count: 0, rows: [] };
      }

      const rows = input.data.map((item) =>
        context.mapSqlRow(item as Record<string, unknown>),
      );

      await context.executeOrThrow(
        context.insertMany(rows, { returning: false }),
      );

      return {
        count: rows.length,
        rows: [],
      };
    },

    async updateMany(context, input) {
      // MySQL lacks RETURNING; rows are fetched before mutation. For atomicity, wrap in $transaction().
      const beforeRows = await context.selectRows({ where: input.where });

      await context.executeOrThrow(
        context.update({ where: input.where, data: input.data }),
      );

      return {
        count: beforeRows.length,
        rows: mergeRows(
          beforeRows,
          input.data as Partial<Record<string, unknown>>,
        ),
      };
    },

    async deleteMany(context, input) {
      // MySQL lacks RETURNING; rows are fetched before mutation. For atomicity, wrap in $transaction().
      const rows = await context.selectRows({ where: input.where });

      await context.executeOrThrow(
        context.deleteByWhere({ where: input.where }),
      );

      return {
        count: rows.length,
        rows,
      };
    },
  };
}
