import { getDialect } from "../dialect/index.js";
import type { Table } from "../table/types.js";
import type {
  BuildOrmClientInput,
  BuildTableClientsInput,
  CreateManyOptions,
  CreateOptions,
  CreateOrmOptions,
  CreateResult,
  CreateTableClientInput,
  DeleteManyOptions,
  DeleteOptions,
  DeleteResult,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  GlobalOrmHooks,
  HasMany,
  HasOne,
  ObjectEntries,
  OrmClient,
  OrmHookContext,
  OrmHooksConfig,
  OrmQueryOptions,
  OrmTableClients,
  RelationsFor,
  StringKeyOf,
  TableClient,
  TableRelations,
  TableRelationsFor,
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

const shouldSkipHooks = (options: OrmQueryOptions | undefined) => {
  return options?.$skipHooks === true;
};

const withoutSkipHooks = <T extends OrmQueryOptions>(options: T) => {
  const { $skipHooks, ...queryOptions } = options;

  return queryOptions;
};

const toHookOptions = <T extends OrmQueryOptions>(options: T | undefined) => {
  if (!options) {
    return undefined;
  }

  return withoutSkipHooks(options);
};

const pickGlobalHooks = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  hooksConfig: OrmHooksConfig<T, R>,
): GlobalOrmHooks => {
  const { tables, ...globalHooks } = hooksConfig;

  return globalHooks;
};

const runHook = async <THookContext>(
  hook: ((ctx: THookContext) => void | Promise<void>) | undefined,
  ctx: THookContext,
) => {
  await hook?.(ctx);
};

const runReadHooks = async <THookContext>(
  globalHook: ((ctx: THookContext) => void | Promise<void>) | undefined,
  tableHook: ((ctx: THookContext) => void | Promise<void>) | undefined,
  ctx: THookContext,
) => {
  await runHook(globalHook, ctx);
  await runHook(tableHook, ctx);
};

const withReadHooks = async <TResult, TOptions>(input: {
  skipHooks: boolean;
  tableName: string;
  table: Table;
  hookOptions: TOptions;
  beforeGlobal?: (ctx: OrmHookContext<TOptions>) => void | Promise<void>;
  beforeTable?: (ctx: OrmHookContext<TOptions>) => void | Promise<void>;
  afterGlobal?: (
    ctx: OrmHookContext<TOptions, TResult>,
  ) => void | Promise<void>;
  afterTable?: (ctx: OrmHookContext<TOptions, TResult>) => void | Promise<void>;
  query: () => Promise<TResult>;
}) => {
  const beforeCtx = {
    tableName: input.tableName,
    table: input.table,
    options: input.hookOptions,
  };

  if (!input.skipHooks) {
    await runReadHooks(input.beforeGlobal, input.beforeTable, beforeCtx);
  }

  const result = await input.query();

  if (!input.skipHooks) {
    await runReadHooks(input.afterGlobal, input.afterTable, {
      ...beforeCtx,
      result,
    });
  }

  return result;
};

const createTableClient = <T extends Table, TRelations extends TableRelations>(
  input: CreateTableClientInput<T, TRelations>,
): TableClient<T, TRelations> => {
  const {
    sql,
    tableName,
    table,
    adapter,
    relations,
    tableRelationsMap,
    globalHooks,
    tableHooks,
  } = input;

  const dialect = getDialect({ adapter, table, relations, tableRelationsMap });

  return {
    findMany: async <const TOptions extends FindManyOptions<T, TRelations>>(
      options?: TOptions,
    ) => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = toHookOptions(options);

      return withReadHooks({
        skipHooks,
        tableName,
        table,
        hookOptions,
        beforeGlobal: globalHooks?.beforeFindMany,
        beforeTable: tableHooks?.beforeFindMany,
        afterGlobal: globalHooks?.afterFindMany,
        afterTable: tableHooks?.afterFindMany,
        query: () => dialect.findMany(sql, hookOptions),
      });
    },

    findFirst: async <const TOptions extends FindFirstOptions<T, TRelations>>(
      options?: TOptions,
    ) => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = toHookOptions(options);

      return withReadHooks({
        skipHooks,
        tableName,
        table,
        hookOptions,
        beforeGlobal: globalHooks?.beforeFindFirst,
        beforeTable: tableHooks?.beforeFindFirst,
        afterGlobal: globalHooks?.afterFindFirst,
        afterTable: tableHooks?.afterFindFirst,
        query: () => dialect.findFirst(sql, hookOptions),
      });
    },

    findUnique: async <const TOptions extends FindUniqueOptions<T, TRelations>>(
      options: TOptions,
    ) => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);

      return withReadHooks({
        skipHooks,
        tableName,
        table,
        hookOptions,
        beforeGlobal: globalHooks?.beforeFindUnique,
        beforeTable: tableHooks?.beforeFindUnique,
        afterGlobal: globalHooks?.afterFindUnique,
        afterTable: tableHooks?.afterFindUnique,
        query: () => dialect.findUnique(sql, hookOptions),
      });
    },

    create: async <const TOptions extends CreateOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<CreateResult<T, TRelations, TOptions>> => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);
      let queryOptions = hookOptions;

      if (!skipHooks) {
        const createHookResult = await globalHooks?.beforeCreate?.({
          tableName,
          table,
          options: hookOptions,
        });

        queryOptions = { ...hookOptions, ...createHookResult };

        const tableCreateHookResult = await tableHooks?.beforeCreate?.({
          tableName,
          table,
          options: queryOptions,
        });

        queryOptions = { ...queryOptions, ...tableCreateHookResult };
      }

      const result = await dialect.create(sql, queryOptions);

      if (!skipHooks) {
        await runReadHooks(globalHooks?.afterCreate, tableHooks?.afterCreate, {
          tableName,
          table,
          options: queryOptions,
          result,
        });
      }

      return result;
    },

    createMany: async (options: CreateManyOptions<T>) => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);
      let queryOptions = hookOptions;

      if (!skipHooks) {
        const createManyHookResult = await globalHooks?.beforeCreateMany?.({
          tableName,
          table,
          options: hookOptions,
        });

        queryOptions = { ...hookOptions, ...createManyHookResult };

        const tableCreateManyHookResult = await tableHooks?.beforeCreateMany?.({
          tableName,
          table,
          options: queryOptions,
        });

        queryOptions = { ...queryOptions, ...tableCreateManyHookResult };
      }

      const result = await dialect.createMany(sql, queryOptions);

      if (!skipHooks) {
        const hookCtx = {
          tableName,
          table,
          options: queryOptions,
          result,
        };

        await runHook(globalHooks?.afterCreateMany, hookCtx);
        await runHook(tableHooks?.afterCreateMany, hookCtx);
      }

      return result;
    },

    update: async <const TOptions extends UpdateOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<UpdateResult<T, TRelations, TOptions>> => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);
      let queryOptions = hookOptions;

      if (!skipHooks) {
        const updateHookResult = await globalHooks?.beforeUpdate?.({
          tableName,
          table,
          options: hookOptions,
        });

        queryOptions = { ...hookOptions, ...updateHookResult };

        const tableUpdateHookResult = await tableHooks?.beforeUpdate?.({
          tableName,
          table,
          options: queryOptions,
        });

        queryOptions = { ...queryOptions, ...tableUpdateHookResult };
      }

      const result = await dialect.update(sql, queryOptions);

      if (!skipHooks) {
        await runReadHooks(globalHooks?.afterUpdate, tableHooks?.afterUpdate, {
          tableName,
          table,
          options: queryOptions,
          result,
        });
      }

      return result;
    },

    updateMany: async (options: UpdateManyOptions<T, TRelations>) => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);
      let queryOptions = hookOptions;

      if (!skipHooks) {
        const updateManyHookResult = await globalHooks?.beforeUpdateMany?.({
          tableName,
          table,
          options: hookOptions,
        });

        queryOptions = { ...hookOptions, ...updateManyHookResult };

        const tableUpdateManyHookResult = await tableHooks?.beforeUpdateMany?.({
          tableName,
          table,
          options: queryOptions,
        });

        queryOptions = { ...queryOptions, ...tableUpdateManyHookResult };
      }

      const result = await dialect.updateMany(sql, queryOptions);

      if (!skipHooks) {
        const hookCtx = {
          tableName,
          table,
          options: queryOptions,
          result,
        };

        await runHook(globalHooks?.afterUpdateMany, hookCtx);
        await runHook(tableHooks?.afterUpdateMany, hookCtx);
      }

      return result;
    },

    delete: async <const TOptions extends DeleteOptions<T, TRelations>>(
      options: TOptions,
    ): Promise<DeleteResult<T, TRelations, TOptions>> => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);
      let queryOptions = hookOptions;

      if (!skipHooks) {
        const deleteHookResult = await globalHooks?.beforeDelete?.({
          tableName,
          table,
          options: hookOptions,
        });

        queryOptions = { ...hookOptions, ...deleteHookResult };

        const tableDeleteHookResult = await tableHooks?.beforeDelete?.({
          tableName,
          table,
          options: queryOptions,
        });

        queryOptions = { ...queryOptions, ...tableDeleteHookResult };
      }

      const result = await dialect.delete(sql, queryOptions);

      if (!skipHooks) {
        await runReadHooks(globalHooks?.afterDelete, tableHooks?.afterDelete, {
          tableName,
          table,
          options: queryOptions,
          result,
        });
      }

      return result;
    },

    deleteMany: async (options: DeleteManyOptions<T, TRelations>) => {
      const skipHooks = shouldSkipHooks(options);
      const hookOptions = withoutSkipHooks(options);
      let queryOptions = hookOptions;

      if (!skipHooks) {
        const deleteManyHookResult = await globalHooks?.beforeDeleteMany?.({
          tableName,
          table,
          options: hookOptions,
        });

        queryOptions = { ...hookOptions, ...deleteManyHookResult };

        const tableDeleteManyHookResult = await tableHooks?.beforeDeleteMany?.({
          tableName,
          table,
          options: queryOptions,
        });

        queryOptions = { ...queryOptions, ...tableDeleteManyHookResult };
      }

      const result = await dialect.deleteMany(sql, queryOptions);

      if (!skipHooks) {
        const hookCtx = {
          tableName,
          table,
          options: queryOptions,
          result,
        };

        await runHook(globalHooks?.afterDeleteMany, hookCtx);
        await runHook(tableHooks?.afterDeleteMany, hookCtx);
      }

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
): NonNullable<R[K]> => {
  if (!relations) {
    return Object.create(null);
  }

  if (!Object.hasOwn(relations, tableName)) {
    return Object.create(null);
  }

  const tableRelations = relations[tableName];

  if (!tableRelations) {
    return Object.create(null);
  }

  return tableRelations;
};

const buildTableClients = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  input: BuildTableClientsInput<T, R>,
): OrmTableClients<T, R> => {
  const { tables, relations, sql, adapter, tableRelationsMap, hooks } = input;

  const clients = Object.create(null);

  for (const entry of toObjectEntries(tables)) {
    const setTableClient = <K extends StringKeyOf<T>>(
      tableName: K,
      table: T[K],
    ) => {
      const tableRelations = getTableRelations(relations, tableName);

      tableRelationsMap.set(table, tableRelations);
      clients[tableName] = createTableClient<T[K], TableRelationsFor<R, K>>({
        sql,
        tableName,
        table,
        adapter,
        // @ts-expect-error TableRelationsFor and NonNullable<R[K]> are equivalent here
        relations: tableRelations,
        tableRelationsMap,
        globalHooks: hooks ? pickGlobalHooks(hooks) : undefined,
        tableHooks: hooks?.tables?.[tableName],
      });
    };

    setTableClient(entry[0], entry[1]);
  }

  return clients;
};

const buildOrmClient = <
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
>(
  input: BuildOrmClientInput<T, R>,
): OrmClient<T, R> => {
  const { tableClients, sql, transaction } = input;

  return {
    ...tableClients,
    $raw: sql,
    $transaction: transaction,
  };
};

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
  const tableClients = buildTableClients({
    tables: options.tables,
    relations: options.relations,
    sql,
    adapter: options.adapter,
    tableRelationsMap,
    hooks: options.hooks,
  });

  const orm = buildOrmClient<T, R>({
    tableClients,
    sql,
    transaction: async <TResult>(
      callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
    ): Promise<TResult> => {
      return await sql.begin(async (txSql) => {
        const txTableClients = buildTableClients({
          tables: options.tables,
          relations: options.relations,
          sql: txSql,
          adapter: options.adapter,
          tableRelationsMap,
          hooks: options.hooks,
        });

        const txClient = buildTransactionClient<T, R>(txTableClients, txSql);

        return await callback(txClient);
      });
    },
  });

  return orm;
};
