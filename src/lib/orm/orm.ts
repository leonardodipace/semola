import type { TransactionSQL } from "bun";
import { SQL } from "bun";
import { mightThrow } from "../errors/index.js";
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
  ColumnKind,
  ColumnMetaBase,
  CreateInput,
  CreateManyInput,
  DeleteBuilderInput,
  DeleteManyInput,
  Dialect,
  FindFirstInput,
  FindManyInput,
  FindUniqueInput,
  InsertInput,
  RelationDefs,
  TableRow,
  TinyTableClient,
  UpdateBuilderInput,
  UpdateManyInput,
  WhereInput,
} from "./types.js";

type AnyColumnDef = {
  kind: ColumnKind;
  meta: ColumnMetaBase;
};

function getPrimaryKeyColumn(table: Table<ColDefs>) {
  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (col.meta.isPrimaryKey) {
      return { jsKey, col };
    }
  }

  return null;
}

function findColumnBySqlName(table: Table<ColDefs>, sqlName: string) {
  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    if (col.meta.sqlName === sqlName) {
      return { jsKey, col };
    }
  }

  return null;
}

function findTableKeyByValue(
  tables: Record<string, Table<ColDefs>>,
  targetTable: Table<ColDefs>,
) {
  for (const tableKey in tables) {
    const table = tables[tableKey];

    if (!table) {
      continue;
    }

    if (table === targetTable) {
      return tableKey;
    }
  }

  return null;
}

function findManyForeignKeyByReference(
  sourceTable: Table<ColDefs>,
  sourcePk: AnyColumnDef,
) {
  for (const key in sourceTable.columns) {
    const col = sourceTable.columns[key];

    if (!col) {
      continue;
    }

    if (!col.meta.references) {
      continue;
    }

    const referenced = col.meta.references();

    if (referenced === sourcePk) {
      return col.meta.sqlName;
    }
  }

  return null;
}

function inferManyForeignKeyFromInverse(
  sourceTable: Table<ColDefs>,
  targetTable: Table<ColDefs>,
  allRelations: Partial<Record<string, RelationDefs>>,
  allTables: Record<string, Table<ColDefs>>,
) {
  const targetTableKey = findTableKeyByValue(allTables, targetTable);

  if (!targetTableKey) {
    return null;
  }

  const targetRels = allRelations[targetTableKey];

  if (!targetRels) {
    return null;
  }

  for (const relKey in targetRels) {
    const rel = targetRels[relKey];

    if (!rel) {
      continue;
    }

    if (rel.kind !== "one") {
      continue;
    }

    if (rel.table() !== sourceTable) {
      continue;
    }

    return rel.foreignKey;
  }

  return null;
}

function buildSelectColumns(
  sql: SQL | TransactionSQL,
  table: Table<ColDefs>,
): SQL.Query<unknown> {
  const fragments: SQL.Query<unknown>[] = [];

  for (const jsKey in table.columns) {
    const col = table.columns[jsKey];

    if (!col) {
      continue;
    }

    fragments.push(
      sql`${sql(table.tableName)}.${sql(col.meta.sqlName)} AS ${sql(jsKey)}`,
    );
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
}

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

function toOrmErrorMessage(errorValue: unknown) {
  if (errorValue instanceof Error) {
    return errorValue.message;
  }

  if (typeof errorValue === "object" && errorValue !== null) {
    const message = Reflect.get(errorValue, "message");

    if (typeof message === "string") {
      return message;
    }
  }

  return "Unknown ORM error";
}

async function executeOrThrow<T>(promise: Promise<T>) {
  const [error, data] = await mightThrow(promise);

  if (error !== null) {
    throw new Error(toOrmErrorMessage(error));
  }

  if (data === null) {
    throw new Error("ORM operation returned no data");
  }

  return data;
}

function createTableClient<T extends ColDefs, TRels extends RelationDefs>(
  sql: SQL | TransactionSQL,
  table: Table<T>,
  relations: TRels,
  dialectAdapter: ReturnType<typeof getDialectAdapter>,
  allTables: Record<string, Table<ColDefs>>,
  allRelations: Partial<Record<string, RelationDefs>>,
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

  const normalizeRowsForTable = (
    targetTable: Table<ColDefs>,
    rows: Record<string, unknown>[],
  ) => {
    if (dialectAdapter.dialect !== "postgres") {
      return rows;
    }

    return rows.map((row) => {
      let normalized: Record<string, unknown> | null = null;

      for (const jsKey in targetTable.columns) {
        const col = targetTable.columns[jsKey];

        if (!col) {
          continue;
        }

        if (!col.meta.isSqlArray) {
          continue;
        }

        const value = Reflect.get(row, jsKey);

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

      return normalized;
    });
  };

  const selectWhereIn = async (
    targetTable: Table<ColDefs>,
    sqlColumnName: string,
    values: unknown[],
  ) => {
    if (values.length === 0) {
      return [];
    }

    const columns = buildSelectColumns(sql, targetTable);
    const rows = await executeOrThrow(
      sql`SELECT ${columns} FROM ${sql(targetTable.tableName)} WHERE ${sql(targetTable.tableName)}.${sql(sqlColumnName)} IN ${sql(values)}`,
    );

    return normalizeRowsForTable(
      targetTable,
      rows as Record<string, unknown>[],
    );
  };

  const hydrateIncludedRelations = async (
    rows: TableRow<T>[],
    include: FindManyInput<T, TRels>["include"] | undefined,
  ) => {
    if (!include) {
      return rows;
    }

    const basePk = getPrimaryKeyColumn(table as unknown as Table<ColDefs>);

    if (!basePk) {
      return rows;
    }

    for (const [relationKey, enabled] of Object.entries(include)) {
      if (enabled !== true) {
        continue;
      }

      const relation = relations[relationKey as keyof TRels];

      if (!relation) {
        continue;
      }

      const targetTable = relation.table();
      const targetPk = getPrimaryKeyColumn(targetTable);

      if (relation.kind === "one") {
        if (!targetPk) {
          for (const row of rows) {
            Reflect.set(row as Record<string, unknown>, relationKey, null);
          }

          continue;
        }

        const sourceFk = findColumnBySqlName(
          table as unknown as Table<ColDefs>,
          relation.foreignKey,
        );

        if (!sourceFk) {
          for (const row of rows) {
            Reflect.set(row as Record<string, unknown>, relationKey, null);
          }

          continue;
        }

        const fkValues: unknown[] = [];

        for (const row of rows) {
          const value = Reflect.get(
            row as Record<string, unknown>,
            sourceFk.jsKey,
          );

          if (value === null || value === undefined) {
            continue;
          }

          fkValues.push(value);
        }

        const targetRows = await selectWhereIn(
          targetTable,
          targetPk.col.meta.sqlName,
          fkValues,
        );

        const byPk = new Map<unknown, Record<string, unknown>>();

        for (const targetRow of targetRows) {
          const key = Reflect.get(targetRow, targetPk.jsKey);

          if (key === null || key === undefined) {
            continue;
          }

          byPk.set(key, targetRow);
        }

        for (const row of rows) {
          const sourceKey = Reflect.get(
            row as Record<string, unknown>,
            sourceFk.jsKey,
          );

          if (sourceKey === null || sourceKey === undefined) {
            Reflect.set(row as Record<string, unknown>, relationKey, null);
            continue;
          }

          Reflect.set(
            row as Record<string, unknown>,
            relationKey,
            byPk.get(sourceKey) ?? null,
          );
        }

        continue;
      }

      let foreignKeySqlName: string | null | undefined = relation.foreignKey;

      if (!foreignKeySqlName) {
        foreignKeySqlName = findManyForeignKeyByReference(
          targetTable,
          basePk.col,
        );
      }

      if (!foreignKeySqlName) {
        foreignKeySqlName = inferManyForeignKeyFromInverse(
          table as unknown as Table<ColDefs>,
          targetTable,
          allRelations,
          allTables,
        );
      }

      if (!foreignKeySqlName) {
        for (const row of rows) {
          Reflect.set(row as Record<string, unknown>, relationKey, []);
        }

        continue;
      }

      const targetFk = findColumnBySqlName(targetTable, foreignKeySqlName);

      if (!targetFk) {
        for (const row of rows) {
          Reflect.set(row as Record<string, unknown>, relationKey, []);
        }

        continue;
      }

      const baseIds: unknown[] = [];

      for (const row of rows) {
        const id = Reflect.get(row as Record<string, unknown>, basePk.jsKey);

        if (id === null || id === undefined) {
          continue;
        }

        baseIds.push(id);
      }

      const targetRows = await selectWhereIn(
        targetTable,
        targetFk.col.meta.sqlName,
        baseIds,
      );

      const grouped = new Map<unknown, Record<string, unknown>[]>();

      for (const targetRow of targetRows) {
        const sourceId = Reflect.get(targetRow, targetFk.jsKey);

        if (sourceId === null || sourceId === undefined) {
          continue;
        }

        const existing = grouped.get(sourceId);

        if (!existing) {
          grouped.set(sourceId, [targetRow]);
          continue;
        }

        existing.push(targetRow);
      }

      for (const row of rows) {
        const id = Reflect.get(row as Record<string, unknown>, basePk.jsKey);

        if (id === null || id === undefined) {
          Reflect.set(row as Record<string, unknown>, relationKey, []);
          continue;
        }

        Reflect.set(
          row as Record<string, unknown>,
          relationKey,
          grouped.get(id) ?? [],
        );
      }
    }

    return rows;
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
      const rows = await executeOrThrow(select(mapFindInputToSelect(input)));
      const normalizedRows = normalizeRows(rows);
      return hydrateIncludedRelations(normalizedRows, input?.include);
    },

    async findFirst(input?: FindFirstInput<T, TRels>) {
      const rows = await executeOrThrow(
        select({ ...mapFindInputToSelect(input), limit: 1 }),
      );

      const normalizedRows = normalizeRows(rows);

      if (input?.include) {
        await hydrateIncludedRelations(normalizedRows, input.include);
      }

      const first = normalizedRows[0] ?? null;
      return first;
    },

    async findUnique(input: FindUniqueInput<T>) {
      const rows = await executeOrThrow(
        select({ where: input.where, limit: 1 }),
      );

      const normalizedRows = normalizeRows(rows);
      const first = normalizedRows[0] ?? null;
      return first;
    },

    insert,

    async create(input: CreateInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        await executeOrThrow(insert({ data: input.data }));

        // MySQL has no RETURNING — re-fetch using inserted data as where clause
        // InsertData<T> values are structurally compatible with WhereInput<T>
        const whereInput = input.data as unknown as WhereInput<T>;
        const rows = await executeOrThrow(
          select({ where: whereInput, limit: 1 }),
        );

        const normalizedRows = normalizeRows(rows);
        const first = normalizedRows[0] ?? null;

        if (!first) {
          throw new Error("Insert returned no rows");
        }

        return first;
      }

      const rows = await executeOrThrow(
        insert({ data: input.data, returning: true }),
      );

      const normalizedRows = normalizeRows(rows);
      const first = normalizedRows[0] ?? null;

      if (!first) {
        throw new Error("Insert returned no rows");
      }

      return first;
    },

    async createMany(input: CreateManyInput<T>) {
      if (input.data.length === 0) {
        return { count: 0, rows: [] };
      }

      const rows = input.data.map((item) =>
        mapDataToSqlRow(table, item as Record<string, unknown>, dialectAdapter),
      );

      if (dialectAdapter.dialect === "mysql") {
        await executeOrThrow(
          sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)}`,
        );

        return { count: rows.length, rows: [] };
      }

      const createdRows = await executeOrThrow(
        sql`INSERT INTO ${sql(table.tableName)} ${sql(rows)} RETURNING ${buildReturningColumns()}`,
      );

      const normalizedRows = normalizeRows(createdRows);

      return { count: normalizedRows.length, rows: normalizedRows };
    },

    update,

    async updateMany(input: UpdateManyInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        if (sql instanceof SQL) {
          const result = await executeOrThrow(
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

          return result;
        }

        // Already in a transaction: operations are already atomic
        const beforeRows = await executeOrThrow(select({ where: input.where }));

        await executeOrThrow(update({ where: input.where, data: input.data }));

        const updatedRows = beforeRows.map((row: TableRow<T>) => ({
          ...row,
          ...input.data,
        }));

        return { count: updatedRows.length, rows: updatedRows };
      }

      const rows = await executeOrThrow(
        update({ where: input.where, data: input.data, returning: true }),
      );

      const normalizedRows = normalizeRows(rows);

      return { count: normalizedRows.length, rows: normalizedRows };
    },

    delete: deleteByWhere,

    async deleteMany(input: DeleteManyInput<T>) {
      if (dialectAdapter.dialect === "mysql") {
        if (sql instanceof SQL) {
          const result = await executeOrThrow(
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

          return result;
        }

        // Already in a transaction: operations are already atomic
        const rows = await executeOrThrow(select({ where: input.where }));

        await executeOrThrow(deleteByWhere({ where: input.where }));

        return { count: rows.length, rows };
      }

      const rows = await executeOrThrow(
        deleteByWhere({ where: input.where, returning: true }),
      );

      const normalizedRows = normalizeRows(rows);

      return { count: normalizedRows.length, rows: normalizedRows };
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
        options.tables as Record<string, Table<ColDefs>>,
        (options.relations ?? {}) as Partial<Record<string, RelationDefs>>,
      );
    }

    // TypeScript cannot verify the dynamic key-to-type mapping at compile time
    return out as unknown as OrmModels<TTables, TRels>;
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
