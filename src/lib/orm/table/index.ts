import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Relation, WithIncluded } from "../relations/types.js";
import type {
  CreateInput,
  DeleteOptions,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  InferTableType,
  UpdateOptions,
  WhereClause,
} from "./types.js";

// Re-export WithIncluded from relations
export type { WithIncluded } from "../relations/types.js";
export type {
  BooleanFilter,
  CreateInput,
  DateFilter,
  DeleteOptions,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  InferTableType,
  NumberFilter,
  StringFilter,
  UpdateInput,
  UpdateOptions,
  WhereClause,
} from "./types.js";

export class Table<
  Columns extends Record<string, Column<ColumnKind, ColumnMeta>> = Record<
    string,
    Column<ColumnKind, ColumnMeta>
  >,
  _Relations extends Record<string, Relation> = {},
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
  private readonly relations?: Record<string, Relation>;
  private readonly getTableClient?: (
    relation: Relation,
  ) => TableClient<Table> | undefined;

  public constructor(
    sql: Bun.SQL,
    table: T,
    relations?: Record<string, Relation>,
    getTableClient?: (relation: Relation) => TableClient<Table> | undefined,
  ) {
    this.sql = sql;
    this.table = table;
    this.relations = relations;
    this.getTableClient = getTableClient;
  }

  private validateColumnName(key: string) {
    const columnNames = Object.keys(this.table.columns);

    if (!columnNames.includes(key)) {
      throw new Error(`Invalid column: ${key}`);
    }
  }

  public getSqlColumnName(key: string): string {
    const column = this.table.columns[key];
    if (!column) {
      throw new Error(`Invalid column: ${key}`);
    }
    return column.sqlName;
  }

  private buildCondition(key: string, value: unknown) {
    const sqlColumnName = this.getSqlColumnName(key);

    if (value === null) {
      return this.sql`${this.sql(sqlColumnName)} IS NULL`;
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
        conditions.push(
          this.sql`${this.sql(sqlColumnName)} = ${filters.equals}`,
        );
      }

      // String operators (case-insensitive, works across all databases)
      if ("contains" in filters && typeof filters.contains === "string") {
        const searchValue = filters.contains as string;
        conditions.push(
          this
            .sql`LOWER(${this.sql(sqlColumnName)}) LIKE LOWER(${`%${searchValue}%`})`,
        );
      }

      // Number/Date comparison operators
      if ("gt" in filters) {
        conditions.push(this.sql`${this.sql(sqlColumnName)} > ${filters.gt}`);
      }
      if ("gte" in filters) {
        conditions.push(this.sql`${this.sql(sqlColumnName)} >= ${filters.gte}`);
      }
      if ("lt" in filters) {
        conditions.push(this.sql`${this.sql(sqlColumnName)} < ${filters.lt}`);
      }
      if ("lte" in filters) {
        conditions.push(this.sql`${this.sql(sqlColumnName)} <= ${filters.lte}`);
      }

      // Handle 'in' operator
      if ("in" in filters && Array.isArray(filters.in)) {
        const inValues = filters.in as unknown[];
        if (inValues.length === 0) {
          conditions.push(this.sql`FALSE`);
        } else if (inValues.length === 1) {
          conditions.push(
            this.sql`${this.sql(sqlColumnName)} = ${inValues[0]}`,
          );
        } else {
          // Build IN clause: col IN (val1, val2, ...)
          let inClause = this
            .sql`${this.sql(sqlColumnName)} IN (${inValues[0]}`;
          for (let i = 1; i < inValues.length; i++) {
            inClause = this.sql`${inClause}, ${inValues[i]}`;
          }
          conditions.push(this.sql`${inClause})`);
        }
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
    return this.sql`${this.sql(sqlColumnName)} = ${value}`;
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
      return this.sql`LIMIT ${take} OFFSET ${skip}`;
    }

    if (skip > 0) {
      return this.sql`LIMIT -1 OFFSET ${skip}`;
    }

    return this.sql`LIMIT ${take}`;
  }

  private convertBooleanValues(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      for (const [_key, column] of Object.entries(this.table.columns)) {
        const sqlColumnName = column.sqlName;
        const value = row[sqlColumnName];

        // Check if this column is a boolean type and convert 0/1 to true/false
        if (column.columnKind === "boolean" && typeof value === "number") {
          row[sqlColumnName] = value === 1;
        }
      }
    }
  }

  private async loadIncludedRelations(
    rows: Record<string, unknown>[],
    include?: Record<string, boolean>,
    getTableClient?: (relation: Relation) => TableClient<Table> | undefined,
  ) {
    if (!include || !this.relations || !getTableClient || rows.length === 0) {
      return;
    }

    // Iterate over includes and check if relation exists in table
    for (const [relationName, shouldInclude] of Object.entries(include)) {
      if (!shouldInclude) continue;

      const relation = this.relations[relationName];
      if (!relation) continue;

      const relatedClient = getTableClient(relation);
      if (!relatedClient) continue;

      if (relation.type === "one") {
        // one() relation: parent has FK pointing to child
        // Get SQL column name for the FK
        const fkSqlColumn = this.getSqlColumnName(relation.fkColumn);

        // Collect unique FK values
        const fkValues = [
          ...new Set(
            rows.map((row) => row[fkSqlColumn]).filter((v) => v != null),
          ),
        ];

        if (fkValues.length === 0) continue;

        // Batch load all related records in a single query using IN operator
        const relatedRecords = await relatedClient.findMany({
          where: { id: { in: fkValues } } as WhereClause<Table>,
        });

        // Build map for quick lookup
        const relatedMap = new Map(
          relatedRecords.map((r) => [(r as Record<string, unknown>).id, r]),
        );

        // Attach loaded relations to rows
        for (const row of rows) {
          const fkValue = row[fkSqlColumn];
          row[relationName] = fkValue ? relatedMap.get(fkValue) : undefined;
        }
      } else if (relation.type === "many") {
        // many() relation: child has FK pointing to parent
        // Get SQL column name for the FK on the related table
        const fkSqlColumn = relatedClient.getSqlColumnName(relation.fkColumn);

        // Collect unique parent IDs
        const parentIds = [
          ...new Set(
            rows
              .map((row) => (row as Record<string, unknown>).id)
              .filter((v) => v != null),
          ),
        ];

        if (parentIds.length === 0) continue;

        // Batch load all related records where FK matches parent IDs
        const relatedRecords = await relatedClient.findMany({
          where: {
            [relation.fkColumn]: { in: parentIds },
          } as WhereClause<Table>,
        });

        // Group related records by their FK value
        const relatedMap = new Map<unknown, unknown[]>();
        for (const record of relatedRecords) {
          const fkValue = (record as Record<string, unknown>)[fkSqlColumn];
          if (!relatedMap.has(fkValue)) {
            relatedMap.set(fkValue, []);
          }
          relatedMap.get(fkValue)!.push(record);
        }

        // Attach loaded relations to rows
        for (const row of rows) {
          const parentId = (row as Record<string, unknown>).id;
          row[relationName] = relatedMap.get(parentId) || [];
        }
      }
    }
  }

  public async findMany<Inc extends Record<string, boolean> | undefined>(
    options?: FindManyOptions<T> & { include?: Inc },
  ): Promise<WithIncluded<InferTableType<T>, T, Inc>[]> {
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

    const rows = await sql;
    this.convertBooleanValues(rows);
    await this.loadIncludedRelations(
      rows,
      options?.include,
      this.getTableClient,
    );
    return rows as WithIncluded<InferTableType<T>, T, Inc>[];
  }

  public async findFirst<Inc extends Record<string, boolean> | undefined>(
    options?: FindFirstOptions<T> & { include?: Inc },
  ): Promise<WithIncluded<InferTableType<T>, T, Inc> | null> {
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
    if (!result) return null;

    const rows = [result];
    this.convertBooleanValues(rows);
    await this.loadIncludedRelations(
      rows,
      options?.include,
      this.getTableClient,
    );
    return (
      (rows[0] as WithIncluded<InferTableType<T>, T, Inc> | undefined) ?? null
    );
  }

  public async findUnique<Inc extends Record<string, boolean> | undefined>(
    options: FindUniqueOptions<T> & { include?: Inc },
  ): Promise<WithIncluded<InferTableType<T>, T, Inc> | null> {
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

    const result = results[0];
    if (!result) return null;

    this.convertBooleanValues([result]);
    await this.loadIncludedRelations(
      [result],
      options?.include,
      this.getTableClient,
    );
    return result as WithIncluded<InferTableType<T>, T, Inc>;
  }

  public async create(data: CreateInput<T>): Promise<InferTableType<T>> {
    if (Object.keys(data).length === 0) {
      throw new Error("create requires at least one field");
    }

    // Build a map to translate JS field names to SQL column names
    const sqlData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const sqlColumnName = this.getSqlColumnName(key);
      sqlData[sqlColumnName] = value;
    }

    const results = await this.sql<InferTableType<T>[]>`
      INSERT INTO ${this.sql(this.table.sqlName)} ${this.sql(sqlData)}
      RETURNING *
    `;

    this.convertBooleanValues(results);
    return results[0]!;
  }

  public async update(options: UpdateOptions<T>): Promise<InferTableType<T>[]> {
    const whereClause = this.buildWhereClause(
      options.where as Record<string, unknown>,
    );

    if (!whereClause) {
      throw new Error("update requires a where clause");
    }

    const dataKeys = Object.keys(options.data);

    if (dataKeys.length === 0) {
      throw new Error("update requires at least one field in data");
    }

    // Build a map to translate JS field names to SQL column names
    const sqlData: Record<string, unknown> = {};
    for (const key of dataKeys) {
      const sqlColumnName = this.getSqlColumnName(key);
      sqlData[sqlColumnName] = (options.data as Record<string, unknown>)[key];
    }

    return await this.sql<InferTableType<T>[]>`
      UPDATE ${this.sql(this.table.sqlName)}
      SET ${this.sql(sqlData)}
      WHERE ${whereClause}
      RETURNING *
    `.then((results) => {
      this.convertBooleanValues(results);
      return results;
    });
  }

  public async delete(options: DeleteOptions<T>): Promise<number> {
    const whereClause = this.buildWhereClause(
      options.where as Record<string, unknown>,
    );

    if (!whereClause) {
      throw new Error("delete requires a where clause");
    }

    const results = await this.sql<InferTableType<T>[]>`
      DELETE FROM ${this.sql(this.table.sqlName)}
      WHERE ${whereClause}
      RETURNING *
    `;

    return results.length;
  }
}
