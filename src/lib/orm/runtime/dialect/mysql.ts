import { SQL } from "bun";
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

      const providedPkValue = Reflect.get(input.data, primaryKey.jsKey);

      if (providedPkValue === null || providedPkValue === undefined) {
        let insertedPkValue: unknown;

        if (typeof insertResult === "object" && insertResult !== null) {
          insertedPkValue = Reflect.get(insertResult, "insertId");
        }

        if (insertedPkValue === null || insertedPkValue === undefined) {
          return selectCreatedRow(input.data);
        }

        const whereByPk: Record<string, unknown> = {};
        Reflect.set(whereByPk, primaryKey.jsKey, insertedPkValue);

        return selectCreatedRow(whereByPk);
      }

      const whereByPk: Record<string, unknown> = {};
      Reflect.set(whereByPk, primaryKey.jsKey, providedPkValue);

      return selectCreatedRow(whereByPk);
    },

    async createMany(context, input) {
      if (input.data.length === 0) {
        return { count: 0, rows: [] };
      }

      const rows = input.data.map((item) =>
        context.mapSqlRow(item as Record<string, unknown>),
      );

      await context.executeOrThrow(context.insertMany(rows, false));

      return {
        count: rows.length,
        rows: [],
      };
    },

    async updateMany(context, input) {
      if (context.runner instanceof SQL) {
        return context.executeOrThrow(
          context.runner.begin(async (tx) => {
            const txContext = context.withRunner(tx);
            const beforeRows = await txContext.selectRows({
              where: input.where,
            });

            await txContext.executeOrThrow(
              txContext.update({ where: input.where, data: input.data }),
            );

            return {
              count: beforeRows.length,
              rows: mergeRows(
                beforeRows,
                input.data as Partial<Record<string, unknown>>,
              ),
            };
          }),
        );
      }

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
      if (context.runner instanceof SQL) {
        return context.executeOrThrow(
          context.runner.begin(async (tx) => {
            const txContext = context.withRunner(tx);
            const beforeRows = await txContext.selectRows({
              where: input.where,
            });

            await txContext.executeOrThrow(
              txContext.deleteByWhere({ where: input.where }),
            );

            return {
              count: beforeRows.length,
              rows: beforeRows,
            };
          }),
        );
      }

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
