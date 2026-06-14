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
  RelationsFor,
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

const createTableClient = <T extends Table, TRelations extends TableRelations>(
  sql: Bun.SQL,
  table: T,
  adapter: Adapter,
  relations: TRelations,
  tableRelationsMap: Map<Table, TableRelations>,
): TableClient<T, TRelations> => {
  const dialect = getDialect({ adapter, table, relations, tableRelationsMap });

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

type StringKeyOf<T extends object> = Extract<keyof T, string>;

type ObjectEntries<T extends object> = {
  [K in StringKeyOf<T>]: [K, T[K]];
}[StringKeyOf<T>][];

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

type OrmTableClients<
  T extends Record<string, Table>,
  R extends RelationsFor<T>,
> = {
  [K in keyof T]: TableClient<T[K], TableRelationsFor<R, K>>;
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
        table,
        adapter,
        tableRelations,
        tableRelationsMap,
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
        );

        const txClient = buildTransactionClient<T, R>(txTableClients, txSql);

        return await callback(txClient);
      });
    },
  );

  return orm;
};
