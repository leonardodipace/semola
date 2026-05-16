import type { Adapter } from "../dialect/index.js";
import { getDialect } from "../dialect/index.js";
import type { Table } from "../table/types.js";
import type {
  CreateManyOptions,
  CreateOptions,
  CreateOrmOptions,
  CreateResult,
  DeleteManyOptions,
  DeleteOptions,
  DeleteResult,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  HasMany,
  HasOne,
  OrmClient,
  Relations,
  TableClient,
  TableRelations,
  UpdateManyOptions,
  UpdateOptions,
  UpdateResult,
} from "./types.js";

export const many = <T extends Table>(table: () => T): HasMany<T> => {
  return {
    _type: "hasMany",
    _table: table(),
  };
};

export const one = <T extends Table>(table: () => T): HasOne<T> => {
  return {
    _type: "hasOne",
    _table: table(),
  };
};

const createTableClient = <T extends Table, TRelations extends TableRelations>(
  sql: Bun.SQL,
  table: T,
  adapter: Adapter,
  relations: TRelations,
): TableClient<T, TRelations> => {
  const dialect = getDialect(adapter, table, relations);

  return {
    findMany: async <const TOptions extends FindManyOptions<T, TRelations>>(
      options?: TOptions,
    ) => {
      return await dialect.findMany<TOptions>(sql, options);
    },

    findFirst: async <const TOptions extends FindFirstOptions<T, TRelations>>(
      options?: TOptions,
    ) => {
      return await dialect.findFirst<TOptions>(sql, options);
    },

    findUnique: async <const TOptions extends FindUniqueOptions<T, TRelations>>(
      options: TOptions,
    ) => {
      return await dialect.findUnique<TOptions>(sql, options);
    },

    create: async <const TOptions extends CreateOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<CreateResult<T, TRelations, TOptions>> => {
      return await dialect.create<TOptions>(sql, options);
    },

    createMany: async (options: CreateManyOptions<T>) => {
      return await dialect.createMany(sql, options);
    },

    update: async <const TOptions extends UpdateOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<UpdateResult<T, TRelations, TOptions>> => {
      return await dialect.update<TOptions>(sql, options);
    },

    updateMany: async (options: UpdateManyOptions<T>) => {
      return await dialect.updateMany(sql, options);
    },

    delete: async <const TOptions extends DeleteOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<DeleteResult<T, TRelations, TOptions>> => {
      return await dialect.delete<TOptions>(sql, options);
    },

    deleteMany: async (options: DeleteManyOptions<T>) => {
      return await dialect.deleteMany(sql, options);
    },
  };
};

export const createOrm = <
  const T extends Record<string, Table>,
  const R extends Relations,
>(
  options: CreateOrmOptions<T, R>,
) => {
  const sql = new Bun.SQL({
    url: options.url,
    adapter: options.adapter,
  });

  const resultEntries = Object.entries(options.tables).map(
    ([tableName, table]) => {
      const tableRelations = (options.relations?.[tableName] ??
        {}) as TableRelations;
      return [
        tableName,
        createTableClient(sql, table, options.adapter, tableRelations),
      ];
    },
  );

  const orm = Object.fromEntries(resultEntries) as OrmClient<T, R>;

  orm.$raw = sql;

  return orm;
};
