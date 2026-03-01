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
  TableRow,
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

  if (url.includes("postgres")) {
    return "postgres";
  }

  if (url.includes("postgresql")) {
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

function createTableClient<T extends ColDefs, TRels extends RelationDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: TRels,
  dialectAdapter: ReturnType<typeof getDialectAdapter>,
): TinyTableClient<T, TRels> {
  const buildReturningColumns = () => {
    const fragments: SQL.Query<unknown>[] = [];

    for (const jsKey in table.columns) {
      const col = table.columns[jsKey];

      if (!col) {
        continue;
      }

      fragments.push(sql`${sql(col.meta.sqlName)} AS ${sql(jsKey)}`);
    }

    const first = fragments[0];

    if (!first) {
      return sql`*`;
    }

    let joined = first;

    for (let index = 1; index < fragments.length; index++) {
      const fragment = fragments[index];

      if (!fragment) {
        continue;
      }

      joined = sql`${joined}, ${fragment}`;
    }

    return joined;
  };

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
        return sql`INSERT INTO ${sql(table.tableName)} ${sql(row)} RETURNING ${buildReturningColumns()}`;
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
        return sql`UPDATE ${sql(table.tableName)} SET ${sql(row)} ${where} RETURNING ${buildReturningColumns()}`;
      }
    }

    return sql`UPDATE ${sql(table.tableName)} SET ${sql(row)} ${where}`;
  };

  const deleteByWhere = (input: DeleteBuilderInput<T>) => {
    const where = serializeWhereInput(sql, table, input.where, dialectAdapter);

    if (input.returning === true) {
      if (dialectAdapter.dialect !== "mysql") {
        return sql`DELETE FROM ${sql(table.tableName)} ${where} RETURNING ${buildReturningColumns()}`;
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
        return err(findErr.type, findErr.message);
      }

      const first = rows[0] ?? null;
      return ok(first);
    },

    async findUnique(input: FindUniqueInput<T>) {
      const [findErr, rows] = await toResult(
        select({ where: input.where, limit: 1 }),
      );

      if (findErr) {
        return err(findErr.type, findErr.message);
      }

      const first = rows[0] ?? null;
      return ok(first);
    },

    insert,

    async create(input: CreateInput<T>) {
      const [createErr, rows] = await toResult(
        insert({ data: input.data, returning: true }),
      );

      if (createErr) {
        return err(createErr.type, createErr.message);
      }

      const first = rows[0] ?? null;

      if (!first) {
        return err("InternalServerError", "Insert returned no rows");
      }

      return ok(first);
    },

    async createMany(input: CreateManyInput<T>) {
      if (input.data.length === 0) {
        return ok({ count: 0, rows: [] });
      }

      const rows = input.data.map((item) =>
        mapDataToSqlRow(table, item as Record<string, unknown>, dialectAdapter),
      );

      if (dialectAdapter.dialect === "mysql") {
        const [createErr] = await toResult(
          sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)}`,
        );

        if (createErr) {
          return err(createErr.type, createErr.message);
        }

        return ok({ count: rows.length, rows: [] });
      }

      const [createErr, createdRows] = await toResult(
        sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)} RETURNING ${buildReturningColumns()}`,
      );

      if (createErr) {
        return err(createErr.type, createErr.message);
      }

      return ok({ count: createdRows.length, rows: createdRows });
    },

    update,

    async updateMany(input: UpdateManyInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        const [beforeUpdateErr, beforeRows] = await toResult(
          select({ where: input.where }),
        );

        if (beforeUpdateErr) {
          return err(beforeUpdateErr.type, beforeUpdateErr.message);
        }

        const [updateErr] = await toResult(
          update({ where: input.where, data: input.data }),
        );

        if (updateErr) {
          return err(updateErr.type, updateErr.message);
        }

        const updatedRows = beforeRows.map((row: TableRow<T>) => ({
          ...row,
          ...input.data,
        }));

        return ok({ count: updatedRows.length, rows: updatedRows });
      }

      const [updateErr, rows] = await toResult(
        update({ where: input.where, data: input.data, returning: true }),
      );

      if (updateErr) {
        return err(updateErr.type, updateErr.message);
      }

      return ok({ count: rows.length, rows });
    },

    delete: deleteByWhere,

    async deleteMany(input: DeleteManyInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        const [beforeDeleteErr, rows] = await toResult(
          select({ where: input.where }),
        );

        if (beforeDeleteErr) {
          return err(beforeDeleteErr.type, beforeDeleteErr.message);
        }

        const [deleteErr] = await toResult(
          deleteByWhere({ where: input.where }),
        );

        if (deleteErr) {
          return err(deleteErr.type, deleteErr.message);
        }

        return ok({ count: rows.length, rows });
      }

      const [deleteErr, rows] = await toResult(
        deleteByWhere({ where: input.where, returning: true }),
      );

      if (deleteErr) {
        return err(deleteErr.type, deleteErr.message);
      }

      return ok({ count: rows.length, rows });
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
      return toResult(sql.begin((tx) => fn(makeModels(tx))));
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
