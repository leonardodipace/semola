import type { Column } from "./column.js";
import type {
  ColumnKind,
  ColumnMeta,
  FindManyOptions,
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

  private buildWhereClause(where: Record<string, unknown>) {
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

  public async findMany(options?: FindManyOptions<T>) {
    if (!options?.where) {
      return this.sql<InferTableType<T>[]>`
        SELECT * FROM ${this.sql(this.table.sqlName)}
      `;
    }

    const whereClause = this.buildWhereClause(options.where);

    if (!whereClause) {
      return this.sql<InferTableType<T>[]>`
        SELECT * FROM ${this.sql(this.table.sqlName)}
      `;
    }

    return this.sql<InferTableType<T>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
      WHERE ${whereClause}
    `;
  }
}
