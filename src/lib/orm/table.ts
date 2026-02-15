import type { Column } from "./column.js";
import type {
  ColumnKind,
  ColumnMeta,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  InferTableType,
} from "./types.js";

export class Table<
  Columns extends Record<string, Column<ColumnKind, ColumnMeta>> = Record<
    string,
    Column<ColumnKind, ColumnMeta>
  >,
> {
  private readonly _sqlName: string;
  private readonly _columns: Columns;

  public constructor(sqlName: string, columns: Columns) {
    this._sqlName = sqlName;
    this._columns = columns;
  }

  public get sqlName() {
    return this._sqlName;
  }

  public get columns() {
    return this._columns;
  }
}

export class TableClient<T extends Table> {
  private readonly sql: Bun.SQL;
  private readonly table: T;

  public constructor(sql: Bun.SQL, table: T) {
    this.sql = sql;
    this.table = table;
  }

  private validateColumnName(key: string) {
    const columnNames = Object.keys(this.table.columns);

    if (!columnNames.includes(key)) {
      throw new Error(`Invalid column: ${key}`);
    }
  }

  private buildCondition(key: string, value: unknown) {
    if (value === null) {
      return this.sql`${this.sql(key)} IS NULL`;
    }

    // Check if value is a filter object (has operator properties)
    if (
      typeof value === "object" &&
      value !== null &&
      !(value instanceof Date)
    ) {
      const filters = value as Record<string, unknown>;
      const conditions = [];

      // Equality operator
      if ("equals" in filters) {
        conditions.push(this.sql`${this.sql(key)} = ${filters.equals}`);
      }

      // String operators
      if ("contains" in filters && typeof filters.contains === "string") {
        conditions.push(
          this.sql`${this.sql(key)} ILIKE ${`%${filters.contains}%`}`,
        );
      }

      // Number/Date comparison operators
      if ("gt" in filters) {
        conditions.push(this.sql`${this.sql(key)} > ${filters.gt}`);
      }
      if ("gte" in filters) {
        conditions.push(this.sql`${this.sql(key)} >= ${filters.gte}`);
      }
      if ("lt" in filters) {
        conditions.push(this.sql`${this.sql(key)} < ${filters.lt}`);
      }
      if ("lte" in filters) {
        conditions.push(this.sql`${this.sql(key)} <= ${filters.lte}`);
      }

      // Combine multiple operators with AND
      if (conditions.length === 0) {
        throw new Error(`No valid operators found for column: ${key}`);
      }

      let combined = conditions[0]!;
      for (let i = 1; i < conditions.length; i++) {
        combined = this.sql`${combined} AND ${conditions[i]}`;
      }

      return combined;
    }

    // Direct equality
    return this.sql`${this.sql(key)} = ${value}`;
  }

  private buildWhereClause(where?: Record<string, unknown>) {
    if (!where) {
      return null;
    }

    const whereEntries = Object.entries(where);

    if (whereEntries.length === 0) {
      return null;
    }

    // Validate all column names first
    for (const [key] of whereEntries) {
      this.validateColumnName(key);
    }

    // Build the first condition
    const [firstEntry] = whereEntries;

    if (!firstEntry) {
      return null;
    }

    const [firstKey, firstValue] = firstEntry;

    let whereClause = this.buildCondition(firstKey, firstValue);

    // Add remaining conditions with AND
    for (let i = 1; i < whereEntries.length; i++) {
      const [key, value] = whereEntries[i]!;
      const condition = this.buildCondition(key, value);

      whereClause = this.sql`${whereClause} AND ${condition}`;
    }

    return whereClause;
  }

  private buildPagination(skip: number, take: number | undefined) {
    if (skip === 0 && !take) {
      return null;
    }

    if (skip > 0 && take) {
      return this.sql`OFFSET ${skip} LIMIT ${take}`;
    }

    if (skip > 0) {
      return this.sql`OFFSET ${skip}`;
    }

    return this.sql`LIMIT ${take}`;
  }

  public async findMany(options?: FindManyOptions<T>) {
    const whereClause = this.buildWhereClause(options?.where);
    const skip = options?.skip ?? 0;
    const take = options?.take;
    const pagination = this.buildPagination(skip, take);

    let sql = this.sql<InferTableType<T>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
    `;

    if (whereClause) {
      sql = this.sql<InferTableType<T>[]>`
        ${sql}
        WHERE ${whereClause}
      `;
    }

    if (pagination) {
      sql = this.sql<InferTableType<T>[]>`
        ${sql}
        ${pagination}
      `;
    }

    return sql;
  }

  public async findFirst(options?: FindFirstOptions<T>) {
    const whereClause = this.buildWhereClause(options?.where);

    let sql = this.sql<InferTableType<T>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
    `;

    if (whereClause) {
      sql = this.sql<InferTableType<T>[]>`
        ${sql}
        WHERE ${whereClause}
      `;
    }

    sql = this.sql<InferTableType<T>[]>`
      ${sql}
      LIMIT 1
    `;

    const [result] = await sql;
    return result ?? null;
  }

  public async findUnique(options: FindUniqueOptions<T>) {
    // Runtime validation: ensure only unique/primary key columns are used
    const whereKeys = Object.keys(options.where as object);

    if (whereKeys.length === 0) {
      throw new Error(
        "findUnique requires at least one column in where clause",
      );
    }

    if (whereKeys.length > 1) {
      throw new Error("findUnique requires exactly one column in where clause");
    }

    const columnKey = whereKeys[0]!;
    const column = this.table.columns[columnKey];

    if (!column) {
      throw new Error(`Invalid column: ${columnKey}`);
    }

    // Check if this column is a primary key or unique column
    const columnWithOptions = column as unknown as {
      options: { primaryKey?: boolean; unique?: boolean };
    };

    if (
      !columnWithOptions.options.primaryKey &&
      !columnWithOptions.options.unique
    ) {
      throw new Error(
        `Column "${columnKey}" is not a primary key or unique column. findUnique requires a unique constraint.`,
      );
    }

    const whereClause = this.buildWhereClause(
      options.where as Record<string, unknown>,
    );

    if (!whereClause) {
      throw new Error("findUnique requires a where clause");
    }

    const results = await this.sql<InferTableType<T>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
      WHERE ${whereClause}
      LIMIT 1
    `;

    return results[0] ?? null;
  }
}
