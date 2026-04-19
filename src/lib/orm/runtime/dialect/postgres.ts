import type { ColDefs, RelationDefs } from "../../types.js";
import type { RuntimeDialect } from "./types.js";
import { expectSingleRow } from "./utils.js";

export function createPostgresRuntimeDialect<
  T extends ColDefs,
  TRels extends RelationDefs,
>(): RuntimeDialect<T, TRels> {
  return {
    async create(context, input) {
      const rows = await context.executeOrThrow(
        context.insertReturning({ data: input.data, returning: true }),
      );

      return expectSingleRow(
        context.normalizeResultRows(rows),
        "Insert returned no rows",
      );
    },

    async createMany(context, input) {
      if (input.data.length === 0) {
        return { count: 0, rows: [] };
      }

      const rows = input.data.map((item) =>
        context.mapSqlRow(item as Record<string, unknown>),
      );

      const createdRows = await context.executeOrThrow(
        context.insertManyReturning(rows),
      );

      const normalizedRows = context.normalizeResultRows(createdRows);

      return {
        count: normalizedRows.length,
        rows: normalizedRows,
      };
    },

    async updateMany(context, input) {
      const rows = await context.executeOrThrow(
        context.updateReturning({
          where: input.where,
          data: input.data,
          returning: true,
        }),
      );

      const normalizedRows = context.normalizeResultRows(rows);

      return {
        count: normalizedRows.length,
        rows: normalizedRows,
      };
    },

    async deleteMany(context, input) {
      const rows = await context.executeOrThrow(
        context.deleteReturning({ where: input.where, returning: true }),
      );

      const normalizedRows = context.normalizeResultRows(rows);

      return {
        count: normalizedRows.length,
        rows: normalizedRows,
      };
    },
  };
}
