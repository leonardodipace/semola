import { SQL } from "bun";
import { err, mightThrow, ok } from "../errors/index.js";
import {
  buildDelete,
  buildInsert,
  buildSelect,
  buildUpdate,
  detectDialect,
  loadRelations,
  mapRow,
  resolveTableMeta,
  type Dialect,
  type TableMeta,
} from "./query.js";
import type {
  Include,
  Insert,
  Select,
  SelectWithInclude,
  Update,
  Where,
} from "./types.js";

// --- Column ---

export class Column<
  TName extends string,
  TType,
  TNullable extends boolean = true,
  TPrimaryKey extends boolean = false,
  THasDefault extends boolean = false,
> {
  public readonly sqlName: TName;
  public readonly isPrimaryKey: TPrimaryKey;
  public readonly isNullable: TNullable;
  public readonly isUnique: boolean;
  public readonly defaultValue: TType | undefined;

  public constructor(
    sqlName: TName,
    options?: {
      nullable?: TNullable;
      primaryKey?: TPrimaryKey;
      unique?: boolean;
      defaultValue?: TType;
    },
  ) {
    this.sqlName = sqlName;
    this.isNullable = (options?.nullable ?? true) as TNullable;
    this.isPrimaryKey = (options?.primaryKey ?? false) as TPrimaryKey;
    this.isUnique = options?.unique ?? false;
    this.defaultValue = options?.defaultValue;
  }

  public notNull() {
    return new Column<TName, TType, false, TPrimaryKey, THasDefault>(
      this.sqlName,
      {
        nullable: false as const,
        primaryKey: this.isPrimaryKey,
        unique: this.isUnique,
        defaultValue: this.defaultValue,
      },
    );
  }

  public primaryKey() {
    return new Column<TName, TType, false, true, THasDefault>(this.sqlName, {
      nullable: false as const,
      primaryKey: true as const,
      unique: this.isUnique,
      defaultValue: this.defaultValue,
    });
  }

  public unique() {
    return new Column<TName, TType, TNullable, TPrimaryKey, THasDefault>(
      this.sqlName,
      {
        nullable: this.isNullable,
        primaryKey: this.isPrimaryKey,
        unique: true,
        defaultValue: this.defaultValue,
      },
    );
  }

  public default(value: TType) {
    return new Column<TName, TType, false, TPrimaryKey, true>(this.sqlName, {
      nullable: false as const,
      primaryKey: this.isPrimaryKey,
      unique: this.isUnique,
      defaultValue: value,
    });
  }
}

// --- Column factories ---

export const string = <TName extends string>(sqlName: TName) =>
  new Column<TName, string>(sqlName);

export const number = <TName extends string>(sqlName: TName) =>
  new Column<TName, number>(sqlName);

export const float = <TName extends string>(sqlName: TName) =>
  new Column<TName, number>(sqlName);

export const boolean = <TName extends string>(sqlName: TName) =>
  new Column<TName, boolean>(sqlName);

export const date = <TName extends string>(sqlName: TName) =>
  new Column<TName, Date>(sqlName);

export const json = <TType, TName extends string>(sqlName: TName) =>
  new Column<TName, TType>(sqlName);

export const blob = <TName extends string>(sqlName: TName) =>
  new Column<TName, Buffer>(sqlName);

export const bigint = <TName extends string>(sqlName: TName) =>
  new Column<TName, bigint>(sqlName);

// --- Relations ---

export class OneRelation<
  TFk extends string,
  TTable,
  TNullable extends boolean = true,
> {
  public readonly _type = "one" as const;
  public readonly foreignKey: TFk;
  public readonly ref: () => TTable;
  public readonly isNullable: TNullable;

  public constructor(foreignKey: TFk, ref: () => TTable, nullable?: TNullable) {
    this.foreignKey = foreignKey;
    this.ref = ref;
    this.isNullable = (nullable ?? true) as TNullable;
  }

  public notNull() {
    return new OneRelation<TFk, TTable, false>(
      this.foreignKey,
      this.ref,
      false as const,
    );
  }
}

export class ManyRelation<TTable> {
  public readonly _type = "many" as const;
  public readonly ref: () => TTable;

  public constructor(ref: () => TTable) {
    this.ref = ref;
  }
}

export const one = <TFk extends string, TTable>(
  foreignKey: TFk,
  ref: () => TTable,
) => new OneRelation(foreignKey, ref);

export const many = <TTable>(ref: () => TTable) => new ManyRelation(ref);

// --- Table ---

export class Table<
  TName extends string,
  TColumns extends Record<string, unknown>,
> {
  public readonly sqlName: TName;
  public readonly columns: TColumns;

  public constructor(sqlName: TName, columns: TColumns) {
    this.sqlName = sqlName;
    this.columns = columns;
  }
}

// --- Type helpers ---

type AnyTable = Table<string, Record<string, unknown>>;

// --- TableClient ---

class TableClient<TColumns extends Record<string, unknown>> {
  private db: InstanceType<typeof SQL>;
  private meta: TableMeta;
  private allTableMetas: Map<string, TableMeta>;
  private dialect: Dialect;

  public constructor(
    db: InstanceType<typeof SQL>,
    meta: TableMeta,
    allTableMetas: Map<string, TableMeta>,
    dialect: Dialect,
  ) {
    this.db = db;
    this.meta = meta;
    this.allTableMetas = allTableMetas;
    this.dialect = dialect;
  }

  public async findMany<TInclude extends Include<TColumns> = {}>(options?: {
    where?: Where<TColumns>;
    include?: TInclude;
    take?: number;
    skip?: number;
  }) {
    const [error, rows] = await mightThrow(
      buildSelect(
        this.db,
        this.meta,
        this.allTableMetas,
        options?.where as Record<string, unknown> | undefined,
        options?.take,
        options?.skip,
      ),
    );

    if (error) return err("QueryError", String(error));

    const results = (rows as Record<string, unknown>[]).map((r) =>
      mapRow(r, this.meta),
    );

    if (options?.include && Object.keys(options.include).length > 0) {
      await loadRelations(
        this.db,
        results,
        options.include as Record<string, true>,
        this.meta,
        this.allTableMetas,
      );
    }

    return ok(results as SelectWithInclude<TColumns, TInclude>[]);
  }

  public async findOne<TInclude extends Include<TColumns> = {}>(options?: {
    where?: Where<TColumns>;
    include?: TInclude;
  }) {
    const [error, rows] = await mightThrow(
      buildSelect(
        this.db,
        this.meta,
        this.allTableMetas,
        options?.where as Record<string, unknown> | undefined,
        1,
        undefined,
      ),
    );

    if (error) return err("QueryError", String(error));

    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return ok(null);

    const result = mapRow(row, this.meta);

    if (options?.include && Object.keys(options.include).length > 0) {
      await loadRelations(
        this.db,
        [result],
        options.include as Record<string, true>,
        this.meta,
        this.allTableMetas,
      );
    }

    return ok(result as SelectWithInclude<TColumns, TInclude>);
  }

  public async create(options: { data: Insert<TColumns> }) {
    const [error, row] = await mightThrow(
      buildInsert(
        this.db,
        this.meta,
        options.data as Record<string, unknown>,
        this.dialect,
      ),
    );

    if (error) return err("QueryError", String(error));
    return ok(row as Select<TColumns>);
  }

  public async update(options: {
    where: Where<TColumns>;
    data: Update<TColumns>;
  }) {
    const [error, row] = await mightThrow(
      buildUpdate(
        this.db,
        this.meta,
        options.data as Record<string, unknown>,
        this.allTableMetas,
        options.where as Record<string, unknown>,
        this.dialect,
      ),
    );

    if (error) return err("QueryError", String(error));
    return ok(row as Select<TColumns>);
  }

  public async delete(options: { where: Where<TColumns> }) {
    const [error, row] = await mightThrow(
      buildDelete(
        this.db,
        this.meta,
        this.allTableMetas,
        options.where as Record<string, unknown>,
        this.dialect,
      ),
    );

    if (error) return err("QueryError", String(error));
    return ok(row as Select<TColumns>);
  }
}

// --- ORM ---

type TableClients<
  TTables extends Record<string, AnyTable>,
  TRelations extends Record<string, unknown>,
> = {
  [K in keyof TTables]: TableClient<
    TTables[K]["columns"] & (K extends keyof TRelations ? TRelations[K] : {})
  >;
};

type OrmOptions<
  TTables extends Record<string, AnyTable>,
  TRelations extends Record<string, unknown>,
> = {
  url: string;
  tables: TTables;
  relations?: TRelations & {
    [K in keyof TTables]?: Record<
      string,
      OneRelation<string, AnyTable, boolean> | ManyRelation<AnyTable>
    >;
  };
};

interface OrmConstructor {
  new <
    TTables extends Record<string, AnyTable>,
    TRelations extends Record<string, unknown> = {},
  >(
    options: OrmOptions<TTables, TRelations>,
  ): OrmImpl<TTables, TRelations> & TableClients<TTables, TRelations>;
}

class OrmImpl<
  TTables extends Record<string, AnyTable>,
  TRelations extends Record<string, unknown>,
> {
  public readonly db: InstanceType<typeof SQL>;
  public readonly dialect: Dialect;

  public constructor(options: OrmOptions<TTables, TRelations>) {
    this.dialect = detectDialect(options.url);
    this.db = new SQL(options.url);

    const allTableMetas = new Map<string, TableMeta>();

    // First pass: build table metas with columns only
    for (const table of Object.values(options.tables)) {
      const meta = resolveTableMeta(table as AnyTable, {});
      allTableMetas.set(meta.sqlName, meta);
    }

    // Second pass: add relations
    if (options.relations) {
      for (const [tableKey, rels] of Object.entries(options.relations)) {
        const table = (options.tables as Record<string, AnyTable>)[tableKey];
        if (!table || !rels) continue;
        const meta = resolveTableMeta(
          table,
          rels as Record<
            string,
            OneRelation<string, AnyTable, boolean> | ManyRelation<AnyTable>
          >,
        );
        allTableMetas.set(meta.sqlName, meta);
      }
    }

    for (const [key, table] of Object.entries(options.tables)) {
      const meta = allTableMetas.get((table as AnyTable).sqlName);
      if (!meta) continue;
      Object.defineProperty(this, key, {
        value: new TableClient(this.db, meta, allTableMetas, this.dialect),
        enumerable: true,
      });
    }
  }

  public async close(options?: { timeout?: number }) {
    await this.db.close(options);
  }
}

export const ORM = OrmImpl as unknown as OrmConstructor;
export type Orm<
  TTables extends Record<string, AnyTable>,
  TRelations extends Record<string, unknown> = {},
> = OrmImpl<TTables, TRelations>;

// Re-export types
export type {
  Include,
  Insert,
  Select,
  SelectWithInclude,
  Update,
  Where,
} from "./types.js";
