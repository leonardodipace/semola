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
  ObjectEntries,
  OrmClient,
  OrmHooks,
  OrmTableClients,
  RelationsFor,
  StringKeyOf,
  TableClient,
  TableRelations,
  TransactionClient,
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

export const one = <T extends Table, const TKey extends string>(
  foreignKey: TKey,
  table: () => T,
): HasOne<T, TKey> => {
  return {
    _type: "hasOne",
    _table: table(),
    _foreignKey: foreignKey,
  };
};

const createTableClient = <T extends Table, TRelations extends TableRelations>(
  sql: Bun.SQL,
  tableName: string,
  table: T,
  adapter: Adapter,
  relations: TRelations,
  tableRelationsMap: Map<Table, TableRelations>,
  hooks: OrmHooks | undefined,
): TableClient<T, TRelations> => {
  const dialect = getDialect({ adapter, table, relations, tableRelationsMap });

  return {
    findMany: async <const TOptions extends FindManyOptions<T, TRelations>>(
      options?: TOptions,
    ) => {
      await hooks?.beforeFindMany?.({ tableName, table, options });

      const result = await dialect.findMany<TOptions>(sql, options);

      await hooks?.afterFindMany?.({ tableName, table, options, result });

      return result;
    },

    findFirst: async <const TOptions extends FindFirstOptions<T, TRelations>>(
      options?: TOptions,
    ) => {
      await hooks?.beforeFindFirst?.({ tableName, table, options });

      const result = await dialect.findFirst<TOptions>(sql, options);

      await hooks?.afterFindFirst?.({ tableName, table, options, result });

      return result;
    },

    findUnique: async <const TOptions extends FindUniqueOptions<T, TRelations>>(
      options: TOptions,
    ) => {
      await hooks?.beforeFindUnique?.({ tableName, table, options });

      const result = await dialect.findUnique<TOptions>(sql, options);

      await hooks?.afterFindUnique?.({ tableName, table, options, result });

      return result;
    },

    create: async <const TOptions extends CreateOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<CreateResult<T, TRelations, TOptions>> => {
      const createHookResult = await hooks?.beforeCreate?.({
        tableName,
        table,
        options,
      });

      Object.assign(options, createHookResult);

      const result = await dialect.create<TOptions>(sql, options);

      await hooks?.afterCreate?.({
        tableName,
        table,
        options,
        result,
      });

      return result;
    },

    createMany: async (options: CreateManyOptions<T>) => {
      const createManyHookResult = await hooks?.beforeCreateMany?.({
        tableName,
        table,
        options,
      });

      Object.assign(options, createManyHookResult);

      const result = await dialect.createMany(sql, options);

      await hooks?.afterCreateMany?.({
        tableName,
        table,
        options,
        result,
      });

      return result;
    },

    update: async <const TOptions extends UpdateOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<UpdateResult<T, TRelations, TOptions>> => {
      const updateHookResult = await hooks?.beforeUpdate?.({
        tableName,
        table,
        options,
      });

      Object.assign(options, updateHookResult);

      const result = await dialect.update<TOptions>(sql, options);

      await hooks?.afterUpdate?.({
        tableName,
        table,
        options,
        result,
      });

      return result;
    },

    updateMany: async (options: UpdateManyOptions<T, TRelations>) => {
      const updateManyHookResult = await hooks?.beforeUpdateMany?.({
        tableName,
        table,
        options,
      });

      Object.assign(options, updateManyHookResult);

      const result = await dialect.updateMany(sql, options);

      await hooks?.afterUpdateMany?.({
        tableName,
        table,
        options,
        result,
      });

      return result;
    },

    delete: async <const TOptions extends DeleteOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<DeleteResult<T, TRelations, TOptions>> => {
      const deleteHookResult = await hooks?.beforeDelete?.({
        tableName,
        table,
        options,
      });

      Object.assign(options, deleteHookResult);

      const result = await dialect.delete<TOptions>(sql, options);

      await hooks?.afterDelete?.({
        tableName,
        table,
        options,
        result,
      });

      return result;
    },

    deleteMany: async (options: DeleteManyOptions<T, TRelations>) => {
      const deleteManyHookResult = await hooks?.beforeDeleteMany?.({
        tableName,
        table,
        options,
      });

      Object.assign(options, deleteManyHookResult);

      const result = await dialect.deleteMany(sql, options);

      await hooks?.afterDeleteMany?.({
        tableName,
        table,
        options,
        result,
      });

      return result;
    },
  };
};

const toObjectEntries = <T extends object>(object: T): ObjectEntries<T> => {
  const result: ObjectEntries<T> = [];

  for (const key in object) {
    if (!Object.hasOwn(object, key)) {
      continue;
    }

    result.push([key, object[key]]);
  }

  return result;
};

const getTableRelations = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
  K extends StringKeyOf<T>,
>(
  relations: R | undefined,
  tableName: K,
): TableRelations => {
  if (!relations) {
    return {};
  }

  if (!Object.hasOwn(relations, tableName)) {
    return {};
  }

  const tableRelations = relations[tableName];

  if (!tableRelations) {
    return {};
  }

  return tableRelations;
};

const buildTableClients = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  tables: T,
  relations: R | undefined,
  sql: Bun.SQL,
  adapter: Adapter,
  tableRelationsMap: Map<Table, TableRelations>,
  hooks: OrmHooks | undefined,
): OrmTableClients<T, R> => {
  const clients = Object.create(null);

  for (const entry of toObjectEntries(tables)) {
    const setTableClient = <K extends StringKeyOf<T>>(
      tableName: K,
      table: T[K],
    ) => {
      const tableRelations = getTableRelations(relations, tableName);

      tableRelationsMap.set(table, tableRelations);
      clients[tableName] = createTableClient(
        sql,
        tableName,
        table,
        adapter,
        tableRelations,
        tableRelationsMap,
        hooks,
      );
    };

    setTableClient(entry[0], entry[1]);
  }

  return clients;
};

const buildOrmClient = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  tableClients: OrmTableClients<T, R>,
  sql: Bun.SQL,
  transaction: <TResult>(
    callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
  ) => Promise<TResult>,
): OrmClient<T, R> => ({
  ...tableClients,
  $raw: sql,
  $transaction: transaction,
});

const buildTransactionClient = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  tableClients: OrmTableClients<T, R>,
  sql: Bun.SQL,
): TransactionClient<T, R> => ({
  ...tableClients,
  $raw: sql,
});

export const createOrm = <
  const T extends Record<string, Table>,
  const R extends RelationsFor<T>,
>(
  options: CreateOrmOptions<T, R>,
) => {
  const sql = new Bun.SQL(options.url, {
    adapter: options.adapter,
  });

  const tableRelationsMap = new Map<Table, TableRelations>();
  const tableClients = buildTableClients(
    options.tables,
    options.relations,
    sql,
    options.adapter,
    tableRelationsMap,
    options.hooks,
  );

  const orm = buildOrmClient<T, R>(
    tableClients,
    sql,
    async <TResult>(
      callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
    ): Promise<TResult> => {
      return await sql.begin(async (txSql) => {
        const txTableClients = buildTableClients(
          options.tables,
          options.relations,
          txSql,
          options.adapter,
          tableRelationsMap,
          options.hooks,
        );

        const txClient = buildTransactionClient<T, R>(txTableClients, txSql);

        return await callback(txClient);
      });
    },
  );

  return orm;
};
