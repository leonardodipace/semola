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
  TransactionClient,
  TransactionOptions,
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
  const resultEntries: [string, TableClient<Table, TableRelations>][] = [];

  for (const [tableName, table] of Object.entries(options.tables)) {
    const tableRelations = (options.relations?.[tableName] ??
      {}) as TableRelations;

    tableRelationsMap.set(table, tableRelations);
    resultEntries.push([
      tableName,
      createTableClient(
        sql,
        table,
        options.adapter,
        tableRelations,
        tableRelationsMap,
      ),
    ]);
  }

  const orm = Object.fromEntries(resultEntries) as OrmClient<T, R>;

  orm.$raw = sql;

  orm.$transaction = async <TResult>(
    callback: (tx: TransactionClient<T, R>) => Promise<TResult>,
    transactionOptions?: TransactionOptions,
  ): Promise<TResult> => {
    const isolationLevel = transactionOptions?.isolationLevel
      ? isolationLevelToSQL(transactionOptions.isolationLevel, options.adapter)
      : undefined;

    let beginOptions = "";

    if (isolationLevel) {
      beginOptions = isolationLevel;
    }

    return await sql.begin(beginOptions, async (txSql) => {
      const txResultEntries: [string, TableClient<Table, TableRelations>][] =
        [];

      for (const [tableName, table] of Object.entries(options.tables)) {
        const tableRelations = (options.relations?.[tableName] ??
          {}) as TableRelations;

        txResultEntries.push([
          tableName,
          createTableClient(
            txSql,
            table,
            options.adapter,
            tableRelations,
            tableRelationsMap,
          ),
        ]);
      }

      const txClient = Object.fromEntries(txResultEntries) as TransactionClient<
        T,
        R
      >;

      txClient.$raw = txSql;

      return await callback(txClient);
    });
  };

  return orm;
};

const isolationLevelToSQL = (level: string, adapter: Adapter): string => {
  if (adapter === "sqlite") {
    switch (level) {
      case "ReadUncommitted":
        return "DEFERRED";
      case "ReadCommitted":
        return "DEFERRED";
      case "RepeatableRead":
        return "IMMEDIATE";
      case "Serializable":
        return "EXCLUSIVE";
      default:
        return "";
    }
  }

  switch (level) {
    case "ReadUncommitted":
      return "ISOLATION LEVEL READ UNCOMMITTED";
    case "ReadCommitted":
      return "ISOLATION LEVEL READ COMMITTED";
    case "RepeatableRead":
      return "ISOLATION LEVEL REPEATABLE READ";
    case "Serializable":
      return "ISOLATION LEVEL SERIALIZABLE";
    default:
      return "";
  }
};
