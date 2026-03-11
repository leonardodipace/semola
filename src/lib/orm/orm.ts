import type { TransactionSQL } from "bun";
import { SQL } from "bun";
import { err, ok } from "../errors/index.js";
import { getDialectAdapter } from "./dialect/index.js";
import { parsePostgresArrayLiteral } from "./sql/parse-array.js";
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
  WhereInput,
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

  if (url.includes("postgresql")) {
    return "postgres";
  }

  if (url.includes("postgres")) {
    return "postgres";
  }

  return "sqlite";
}

function toOrmError(errorValue: unknown): OrmResultError {
  if (errorValue instanceof Error) {
    return { type: "InternalServerError", message: errorValue.message };
  }

  if (typeof errorValue === "object" && errorValue !== null) {
    const type = Reflect.get(errorValue, "type");
    const message = Reflect.get(errorValue, "message");

    if (typeof type === "string" && typeof message === "string") {
      return { type, message };
    }

    if (typeof message === "string") {
      return { type: "InternalServerError", message };
    }
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
  const normalizeRow = (row: TableRow<T>) => {
    if (dialectAdapter.dialect !== "postgres") {
      return row;
    }

    let normalized: Record<string, unknown> | null = null;

    for (const jsKey in table.columns) {
      const col = table.columns[jsKey];

      if (!col) {
        continue;
      }

      if (!col.meta.isSqlArray) {
        continue;
      }

      const value = Reflect.get(row as Record<string, unknown>, jsKey);

      if (Array.isArray(value)) {
        continue;
      }

      if (typeof value !== "string") {
        continue;
      }

      const parsed = parsePostgresArrayLiteral(value);

      if (!parsed) {
        continue;
      }

      if (!normalized) {
        normalized = { ...row };
      }

      normalized[jsKey] = parsed;
    }

    if (!normalized) {
      return row;
    }

    return normalized as TableRow<T>;
  };

  const normalizeRows = (rows: TableRow<T>[]) => {
    return rows.map((row) => normalizeRow(row));
  };

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

    async findMany(input) {
      const [findErr, rows] = await toResult(
        select(mapFindInputToSelect(input)),
      );

      if (findErr) {
        return err(findErr.type, findErr.message);
      }

      return ok(normalizeRows(rows));
    },

    async findFirst(input?: FindFirstInput<T, TRels>) {
      const [findErr, rows] = await toResult(
        select({ ...mapFindInputToSelect(input), limit: 1 }),
      );

      if (findErr) {
        return err(findErr.type, findErr.message);
      }

      const normalizedRows = normalizeRows(rows);
      const first = normalizedRows[0] ?? null;
      return ok(first);
    },

    async findUnique(input: FindUniqueInput<T>) {
      const [findErr, rows] = await toResult(
        select({ where: input.where, limit: 1 }),
      );

      if (findErr) {
        return err(findErr.type, findErr.message);
      }

      const normalizedRows = normalizeRows(rows);
      const first = normalizedRows[0] ?? null;
      return ok(first);
    },

    insert,

    async create(input: CreateInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        const [insertErr] = await toResult(insert({ data: input.data }));

        if (insertErr) {
          return err(insertErr.type, insertErr.message);
        }

        // MySQL has no RETURNING — re-fetch using inserted data as where clause
        // InsertData<T> values are structurally compatible with WhereInput<T>
        const whereInput = input.data as unknown as WhereInput<T>;
        const [fetchErr, rows] = await toResult(
          select({ where: whereInput, limit: 1 }),
        );

        if (fetchErr) {
          return err(fetchErr.type, fetchErr.message);
        }

        const normalizedRows = normalizeRows(rows);
        const first = normalizedRows[0] ?? null;

        if (!first) {
          return err("InternalServerError", "Insert returned no rows");
        }

        return ok(first);
      }

      const [createErr, rows] = await toResult(
        insert({ data: input.data, returning: true }),
      );

      if (createErr) {
        return err(createErr.type, createErr.message);
      }

      const normalizedRows = normalizeRows(rows);
      const first = normalizedRows[0] ?? null;

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

      const normalizedRows = normalizeRows(createdRows);

      return ok({ count: normalizedRows.length, rows: normalizedRows });
    },

    update,

    async updateMany(input: UpdateManyInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        if (sql instanceof SQL) {
          const [txErr, result] = await toResult(
            sql.begin(async (tx) => {
              const beforeRows = await serializeSelectInput(
                tx,
                table,
                relations,
                { where: input.where },
                dialectAdapter,
              );

              const txWhere = serializeWhereInput(
                tx,
                table,
                input.where,
                dialectAdapter,
              );
              const txRow = mapDataToSqlRow(
                table,
                input.data as Record<string, unknown>,
                dialectAdapter,
              );

              await tx`UPDATE ${tx(table.tableName)} SET ${tx(txRow)} ${txWhere}`;

              // Server-side defaults/triggers not reflected — known MySQL limitation
              const updatedRows = beforeRows.map((row: TableRow<T>) => ({
                ...row,
                ...input.data,
              }));

              return { count: updatedRows.length, rows: updatedRows };
            }),
          );

          if (txErr) {
            return err(txErr.type, txErr.message);
          }

          return ok(result);
        }

        // Already in a transaction: operations are already atomic
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

      const normalizedRows = normalizeRows(rows);

      return ok({ count: normalizedRows.length, rows: normalizedRows });
    },

    delete: deleteByWhere,

    async deleteMany(input: DeleteManyInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        if (sql instanceof SQL) {
          const [txErr, result] = await toResult(
            sql.begin(async (tx) => {
              const beforeRows = await serializeSelectInput(
                tx,
                table,
                relations,
                { where: input.where },
                dialectAdapter,
              );

              const txWhere = serializeWhereInput(
                tx,
                table,
                input.where,
                dialectAdapter,
              );

              await tx`DELETE FROM ${tx(table.tableName)} ${txWhere}`;

              return { count: beforeRows.length, rows: beforeRows };
            }),
          );

          if (txErr) {
            return err(txErr.type, txErr.message);
          }

          return ok(result);
        }

        // Already in a transaction: operations are already atomic
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

      const normalizedRows = normalizeRows(rows);

      return ok({ count: normalizedRows.length, rows: normalizedRows });
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
    const out: Record<string, TinyTableClient<ColDefs, RelationDefs>> = {};

    for (const key of Object.keys(options.tables)) {
      const table = options.tables[key];

      if (!table) {
        continue;
      }

      const rels = options.relations?.[key as keyof TRels];
      const relationDefs: RelationDefs = rels ?? {};

      out[key] = createTableClient(
        sqlOrTx,
        table,
        relationDefs,
        dialectAdapter,
      );
    }

    // TypeScript cannot verify the dynamic key-to-type mapping at compile time
    return out as unknown as OrmModels<TTables, TRels>;
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
