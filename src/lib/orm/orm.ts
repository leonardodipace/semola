import type { TransactionSQL } from "bun";
import { SQL } from "bun";
import { err, ok } from "../errors/index.js";
import { getDialectAdapter } from "./dialect/index.js";
import {
  mapDataToSqlRow,
  serializeSelectInput,
  serializeWhereInput,
} from "./sql/serialize.js";
import type { Table } from "./table.js";
import type {
  ColDefs,
  CreateInput,
  CreateManyInput,
  DeleteBuilderInput,
  DeleteManyInput,
  Dialect,
  FindFirstInput,
  FindManyInput,
  FindUniqueInput,
  InsertInput,
  OrmResultError,
  RelationDefs,
  ResultTuple,
  TinyTableClient,
  UpdateBuilderInput,
  UpdateManyInput,
} from "./types.js";

type OrmOptions<
  TTables extends Record<string, Table<ColDefs>>,
  TRels extends Partial<Record<keyof TTables, RelationDefs>>,
> = {
  url: string;
  tables: TTables;
  relations?: TRels;
  dialect?: Dialect;
};

type OrmModels<
  TTables extends Record<string, Table<ColDefs>>,
  TRels extends Partial<Record<keyof TTables, RelationDefs>>,
> = {
  [K in keyof TTables]: TinyTableClient<
    TTables[K] extends Table<infer C> ? C : never,
    K extends keyof TRels ? NonNullable<TRels[K]> : Record<never, never>
  >;
};

function inferDialectFromUrl(url: string): Dialect {
  if (url.includes("mysql")) return "mysql";

  if (url.includes("postgres") || url.includes("postgresql")) {
    return "postgres";
  }

  return "sqlite";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOrmError(errorValue: unknown): OrmResultError {
  if (isObject(errorValue)) {
    const type = errorValue.type;
    const message = errorValue.message;

    if (typeof type === "string" && typeof message === "string") {
      return { type, message };
    }

    if (typeof message === "string") {
      return { type: "InternalServerError", message };
    }
  }

  if (errorValue instanceof Error) {
    return { type: "InternalServerError", message: errorValue.message };
  }

  return { type: "InternalServerError", message: "Unknown ORM error" };
}

function toResult<T>(promise: Promise<T>): Promise<ResultTuple<T>> {
  return promise
    .then((data) => ok(data))
    .catch((errorValue) => {
      const normalized = toOrmError(errorValue);
      return err(normalized.type, normalized.message);
    });
}

function readCount(rows: unknown): number {
  if (!Array.isArray(rows)) {
    return 0;
  }

  const first = rows[0];

  if (!isObject(first)) {
    return 0;
  }

  const count = first.count;

  if (typeof count === "number") {
    return count;
  }

  if (typeof count === "string") {
    const parsed = Number.parseInt(count, 10);

    if (Number.isNaN(parsed)) {
      return 0;
    }

    return parsed;
  }

  return 0;
}

function createTableClient<T extends ColDefs, TRels extends RelationDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: TRels,
  dialectAdapter: ReturnType<typeof getDialectAdapter>,
): TinyTableClient<T, TRels> {
  const select = (input = {}) => {
    return serializeSelectInput(sql, table, relations, input, dialectAdapter);
  };

  const insert = (input: InsertInput<T>) => {
    const row = mapDataToSqlRow(
      table,
      input.data as Record<string, unknown>,
      dialectAdapter,
    );

    if (input.returning === true) {
      if (dialectAdapter.dialect !== "mysql") {
        return sql`INSERT INTO ${sql(table.tableName)} ${sql(row)} RETURNING *`;
      }
    }

    return sql`INSERT INTO ${sql(table.tableName)} ${sql(row)}`;
  };

  const update = (input: UpdateBuilderInput<T>) => {
    const where = serializeWhereInput(sql, table, input.where, dialectAdapter);

    const row = mapDataToSqlRow(
      table,
      input.data as Record<string, unknown>,
      dialectAdapter,
    );

    if (input.returning === true) {
      if (dialectAdapter.dialect !== "mysql") {
        return sql`UPDATE ${sql(table.tableName)} SET ${sql(row)} ${where} RETURNING *`;
      }
    }

    return sql`UPDATE ${sql(table.tableName)} SET ${sql(row)} ${where}`;
  };

  const deleteByWhere = (input: DeleteBuilderInput<T>) => {
    const where = serializeWhereInput(sql, table, input.where, dialectAdapter);

    if (input.returning === true) {
      if (dialectAdapter.dialect !== "mysql") {
        return sql`DELETE FROM ${sql(table.tableName)} ${where} RETURNING *`;
      }
    }

    return sql`DELETE FROM ${sql(table.tableName)} ${where}`;
  };

  const mapFindInputToSelect = (input?: FindManyInput<T, TRels>) => {
    if (!input) {
      return {};
    }

    return {
      where: input.where,
      include: input.include,
      orderBy: input.orderBy,
      limit: input.take,
      offset: input.skip,
    };
  };

  const countByWhere = async (where: DeleteBuilderInput<T>["where"]) => {
    const whereClause = serializeWhereInput(sql, table, where, dialectAdapter);

    const rows =
      await sql`SELECT COUNT(*) as count FROM ${sql(table.tableName)} ${whereClause}`;

    return readCount(rows);
  };

  return {
    select,

    findMany(input) {
      return toResult(select(mapFindInputToSelect(input)));
    },

    async findFirst(input?: FindFirstInput<T, TRels>) {
      const [findErr, rows] = await toResult(
        select({ ...mapFindInputToSelect(input), limit: 1 }),
      );

      if (findErr) {
        return [findErr, null] as const;
      }

      const first = rows[0] ?? null;
      return [null, first] as const;
    },

    async findUnique(input: FindUniqueInput<T>) {
      const [findErr, rows] = await toResult(
        select({ where: input.where, limit: 1 }),
      );

      if (findErr) {
        return [findErr, null] as const;
      }

      const first = rows[0] ?? null;
      return [null, first] as const;
    },

    insert,

    async create(input: CreateInput<T>) {
      const [createErr, rows] = await toResult(
        insert({ data: input.data, returning: true }),
      );

      if (createErr) {
        return [createErr, null] as const;
      }

      const first = rows[0];

      if (!first) {
        return err("InternalServerError", "Insert returned no rows");
      }

      return ok(first);
    },

    async createMany(input: CreateManyInput<T>) {
      const rows = input.data.map((item) =>
        mapDataToSqlRow(table, item as Record<string, unknown>, dialectAdapter),
      );

      const [createErr] = await toResult(
        sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)}`,
      );

      if (createErr) {
        return [createErr, null] as const;
      }

      return ok({ count: rows.length });
    },

    update,

    async updateMany(input: UpdateManyInput<T>) {
      let expectedCount = 0;

      if (dialectAdapter.dialect === "mysql") {
        expectedCount = await countByWhere(input.where);

        const [updateErr] = await toResult(
          update({ where: input.where, data: input.data }),
        );

        if (updateErr) {
          return [updateErr, null] as const;
        }

        return ok({ count: expectedCount });
      }

      const [updateErr, rows] = await toResult(
        update({ where: input.where, data: input.data, returning: true }),
      );

      if (updateErr) {
        return [updateErr, null] as const;
      }

      return ok({ count: rows.length });
    },

    delete: deleteByWhere,

    async deleteMany(input: DeleteManyInput<T>) {
      let expectedCount = 0;

      if (dialectAdapter.dialect === "mysql") {
        expectedCount = await countByWhere(input.where);

        const [deleteErr] = await toResult(
          deleteByWhere({ where: input.where }),
        );

        if (deleteErr) {
          return [deleteErr, null] as const;
        }

        return ok({ count: expectedCount });
      }

      const [deleteErr, rows] = await toResult(
        deleteByWhere({ where: input.where, returning: true }),
      );

      if (deleteErr) {
        return [deleteErr, null] as const;
      }

      return ok({ count: rows.length });
    },
  };
}

export class Orm {
  public constructor(
    public readonly options: OrmOptions<
      Record<string, Table<ColDefs>>,
      Record<string, RelationDefs>
    >,
  ) {}

  public get dialect(): Dialect {
    if (this.options.dialect) {
      return this.options.dialect;
    }

    return inferDialectFromUrl(this.options.url);
  }

  public get tables() {
    return this.options.tables;
  }

  public get relations() {
    return this.options.relations;
  }
}

export function createOrm<
  TTables extends Record<string, Table<ColDefs>>,
  TRels extends Partial<Record<keyof TTables, RelationDefs>>,
>(options: OrmOptions<TTables, TRels>) {
  const sql = new SQL(options.url);
  const dialect = options.dialect ?? inferDialectFromUrl(options.url);
  const dialectAdapter = getDialectAdapter(dialect);

  const makeModels = (
    sqlOrTx: SQL | TransactionSQL,
  ): OrmModels<TTables, TRels> => {
    const out: Partial<OrmModels<TTables, TRels>> = {};

    for (const key of Object.keys(options.tables)) {
      const table = options.tables[key];

      if (!table) {
        continue;
      }

      const rels = options.relations?.[key as keyof TRels];
      const relationDefs = (rels ?? {}) as RelationDefs;

      out[key as keyof TTables] = createTableClient(
        sqlOrTx,
        table,
        relationDefs,
        dialectAdapter,
      ) as OrmModels<TTables, TRels>[keyof TTables];
    }

    return out as OrmModels<TTables, TRels>;
  };

  const client = {
    ...makeModels(sql),

    $transaction<T>(fn: (tx: ReturnType<typeof makeModels>) => Promise<T>) {
      return sql.begin((tx) => fn(makeModels(tx)));
    },

    $raw(strings: TemplateStringsArray, ...values: unknown[]) {
      return sql(strings, ...values);
    },
  };

  Object.defineProperty(client, "__semolaOrm", {
    value: {
      options: { url: options.url },
      dialect,
      tables: options.tables,
    },
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return client;
}
