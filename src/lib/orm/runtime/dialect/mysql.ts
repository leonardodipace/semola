import { SQL } from "bun";
import type { ColDefs, RelationDefs } from "../../types.js";
import type { RuntimeDialect } from "./types.js";
import { expectSingleRow, mergeRows, toWhereInput } from "./utils.js";

export function createMysqlRuntimeDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
>(): RuntimeDialect<T, TRels> {
  return {
    async create(context, input) {
      await context.executeOrThrow(context.insert({ data: input.data }));

      const rows = await context.selectRows({
        where: toWhereInput<T>(input.data),
        limit: 1,
      });

      return expectSingleRow(rows, "Insert returned no rows");
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

            await context.executeOrThrow(
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
