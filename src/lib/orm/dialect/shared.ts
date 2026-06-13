import type { TableRelations } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { DialectQueryBuilder } from "./query-builder.js";
import { executeQuery } from "./rows.js";
import type { CreateDialectInput, Dialect, ReturningQuery } from "./types.js";

export const createDialect = <T extends Table, R extends TableRelations>(
  input: CreateDialectInput<T, R>,
): Dialect<T, R> => {
  const { spec, table, relations, tableRelationsMap = new Map() } = input;

  const builder = new DialectQueryBuilder({
    spec,
    table,
    relations,
    tableRelationsMap,
  });

  const executeAndUnwrap = async (
    sql: Bun.SQL,
    query: ReturningQuery,
    operation: string,
  ) => {
    const [row] = await executeQuery(sql, table, query);

    if (!row) {
      throw new Error(
        `Record not found after ${operation} on table ${table.sqlName}`,
      );
    }

    return row;
  };

  return {
    name: spec.name,
    findMany: async (sql, options) => {
      const query = builder.buildFindMany(options);

      return await executeQuery(sql, table, query);
    },
    findFirst: async (sql, options) => {
      const query = builder.buildFindFirst(options);
      const [row] = await executeQuery(sql, table, query);

      return row ?? null;
    },
    findUnique: async (sql, options) => {
      const query = builder.buildFindUnique(options);
      const [row] = await executeQuery(sql, table, query);

      return row ?? null;
    },
    create: async (sql, options) => {
      const query = builder.buildCreate(options);

      return executeAndUnwrap(sql, query, "insert");
    },
    createMany: async (sql, options) => {
      if (!options.data.length) {
        return [];
      }

      const query = builder.buildCreateMany(options);

      return await executeQuery(sql, table, query);
    },
    update: async (sql, options) => {
      const query = builder.buildUpdate(options);

      return executeAndUnwrap(sql, query, "update");
    },
    updateMany: async (sql, options) => {
      const query = builder.buildUpdateMany(options);

      return await executeQuery(sql, table, query);
    },
    delete: async (sql, options) => {
      const query = builder.buildDelete(options);

      return executeAndUnwrap(sql, query, "delete");
    },
    deleteMany: async (sql, options) => {
      const query = builder.buildDeleteMany(options);

      return await executeQuery(sql, table, query);
    },
  };
};
