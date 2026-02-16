import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Dialect } from "../dialect/types.js";
import type { Relation, WithIncluded } from "../relations/types.js";
import type {
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

type AnyColumnFilter =
  | StringFilter
  | NumberFilter
  | DateFilter
  | BooleanFilter
  | string
  | number
  | boolean
  | Date
  | null;

type AnyWhereClause = Record<string, AnyColumnFilter>;

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
  private readonly dialect: Dialect;

  public constructor(
    sql: Bun.SQL,
    table: T,
    dialect: Dialect,
    relations?: Record<string, Relation>,
    getTableClient?: (relation: Relation) => TableClient<Table> | undefined,
  ) {
    this.sql = sql;
    this.table = table;
    this.dialect = dialect;
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

  private getPrimaryKeyColumn() {
    for (const [key, column] of Object.entries(this.table.columns)) {
      if (column.meta.primaryKey) {
        return { key, sqlName: column.sqlName, kind: column.columnKind };
      }
    }

    return null;
  }

  private isFilterObject(value: unknown): value is Record<string, unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      !(value instanceof Date) &&
      !Array.isArray(value)
    );
  }

  private buildCondition(key: string, value: unknown) {
    const sqlColumnName = this.getSqlColumnName(key);

    if (value === null) {
      return this.sql`${this.sql(sqlColumnName)} IS NULL`;
    }

    // Check if value is a filter object (has operator properties)
    if (this.isFilterObject(value)) {
      const filters = value;
      const conditions = [];

      // Equality operator
      if ("equals" in filters) {
        conditions.push(
          this.sql`${this.sql(sqlColumnName)} = ${filters.equals}`,
        );
      }

      // String operators (case-insensitive, works across all databases)
      if ("contains" in filters && typeof filters.contains === "string") {
        const searchValue = filters.contains;
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
        const inValues = filters.in;
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

      const [firstCondition] = conditions;

      let combined = firstCondition;

      for (let i = 1; i < conditions.length; i++) {
        combined = this.sql`${combined} AND ${conditions[i]}`;
      }

      return combined;
    }

    // Direct equality
    return this.sql`${this.sql(sqlColumnName)} = ${value}`;
  }

  private buildWhereClause(where?: WhereClause<T>) {
    if (!where) {
      return null;
    }

    const whereEntries: [string, unknown][] = Object.entries(where);

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
      const [key, value] = whereEntries[i] ?? [];
      if (!key) continue;
      const condition = this.buildCondition(key, value);

      whereClause = this.sql`${whereClause} AND ${condition}`;
    }

    return whereClause;
  }

  private buildPagination(skip: number, take: number | undefined) {
    if (skip === 0 && !take) {
      return null;
    }

    if (take !== undefined) {
      if (skip > 0) {
        return this.sql`LIMIT ${take} OFFSET ${skip}`;
      }
      return this.sql`LIMIT ${take}`;
    }

    if (skip > 0) {
      // Use dialect to get the right pagination behavior for "skip only" queries
      const paginationStr = this.dialect.buildPagination(undefined, skip);
      if (!paginationStr) {
        return null;
      }

      // For SQLite: "LIMIT -1 OFFSET n"
      // For Postgres: "LIMIT ALL OFFSET n"
      // For MySQL: "LIMIT <max> OFFSET n"
      // We need to parse and reconstruct
      if (paginationStr.includes("LIMIT -1")) {
        return this.sql`LIMIT -1 OFFSET ${skip}`;
      }
      if (paginationStr.includes("LIMIT ALL")) {
        return this.sql`LIMIT ALL OFFSET ${skip}`;
      }
      // MySQL case - extract the limit value
      const match = paginationStr.match(/LIMIT (\d+)/);
      if (match) {
        const limit = Number.parseInt(match[1] ?? "0", 10);
        return this.sql`LIMIT ${limit} OFFSET ${skip}`;
      }
    }

    return null;
  }

  private collectValuesByKind(
    rows: Record<string, unknown>[],
    columnKey: string,
    kind: "number",
  ): number[];
  private collectValuesByKind(
    rows: Record<string, unknown>[],
    columnKey: string,
    kind: "string",
  ): string[];
  private collectValuesByKind(
    rows: Record<string, unknown>[],
    columnKey: string,
    kind: "date",
  ): Date[];
  private collectValuesByKind(
    rows: Record<string, unknown>[],
    columnKey: string,
    kind: "boolean",
  ): boolean[];
  private collectValuesByKind(
    rows: Record<string, unknown>[],
    columnKey: string,
    kind: ColumnKind,
  ) {
    if (kind === "number") {
      return rows
        .map((row) => row[columnKey])
        .filter((value): value is number => typeof value === "number");
    }

    if (kind === "string") {
      return rows
        .map((row) => row[columnKey])
        .filter((value): value is string => typeof value === "string");
    }

    if (kind === "date") {
      return rows
        .map((row) => row[columnKey])
        .filter((value): value is Date => value instanceof Date);
    }

    return rows
      .map((row) => row[columnKey])
      .filter((value): value is boolean => typeof value === "boolean");
  }

  private convertBooleanValues(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      for (const [_key, column] of Object.entries(this.table.columns)) {
        const sqlColumnName = column.sqlName;
        const value = row[sqlColumnName];

        if (column.columnKind === "boolean") {
          row[sqlColumnName] = this.dialect.convertBooleanValue(value);
        }
      }
    }
  }

  // Map SQL column names back to TypeScript property names
  private mapColumnNames(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      for (const [key, column] of Object.entries(this.table.columns)) {
        const sqlColumnName = column.sqlName;

        // If SQL name differs from TS key, map it
        if (sqlColumnName !== key && sqlColumnName in row) {
          row[key] = row[sqlColumnName];
          delete row[sqlColumnName];
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
        // Use TypeScript key directly since rows are already mapped
        const fkKey = relation.fkColumn;

        const relatedPk = relatedClient.getPrimaryKeyColumn();
        if (!relatedPk) {
          throw new Error("Relation requires a primary key on related table");
        }
        if (relatedPk.kind === "boolean") {
          throw new Error(
            "Boolean primary keys are not supported for relation loading",
          );
        }

        let relatedRecords: Record<string, unknown>[] = [];

        if (relatedPk.kind === "number") {
          const fkValues = [
            ...new Set(
              this.collectValuesByKind(rows, fkKey, "number").filter(
                (value) => value != null,
              ),
            ),
          ];

          if (fkValues.length === 0) continue;

          const where: AnyWhereClause = {
            [relatedPk.key]: { in: fkValues },
          };

          relatedRecords = await relatedClient.findMany({ where });
        } else if (relatedPk.kind === "string") {
          const fkValues = [
            ...new Set(
              this.collectValuesByKind(rows, fkKey, "string").filter(
                (value) => value != null,
              ),
            ),
          ];

          if (fkValues.length === 0) continue;

          const where: AnyWhereClause = {
            [relatedPk.key]: { in: fkValues },
          };

          relatedRecords = await relatedClient.findMany({ where });
        } else {
          const fkValues = [
            ...new Set(
              this.collectValuesByKind(rows, fkKey, "date").filter(
                (value) => value != null,
              ),
            ),
          ];

          if (fkValues.length === 0) continue;

          const where: AnyWhereClause = {
            [relatedPk.key]: { in: fkValues },
          };

          relatedRecords = await relatedClient.findMany({ where });
        }

        // Build map for quick lookup
        const relatedMap = new Map<unknown, unknown>();
        for (const record of relatedRecords) {
          if (typeof record !== "object" || record === null) continue;
          const value = Reflect.get(record, relatedPk.key);
          if (value == null) continue;
          relatedMap.set(value, record);
        }

        // Attach loaded relations to rows
        for (const row of rows) {
          const fkValue = row[fkKey];
          row[relationName] =
            fkValue != null ? relatedMap.get(fkValue) : undefined;
        }
      } else if (relation.type === "many") {
        // many() relation: child has FK pointing to parent
        // Use TypeScript key directly since records are already mapped
        const fkKey = relation.fkColumn;

        const parentPk = this.getPrimaryKeyColumn();
        if (!parentPk) {
          throw new Error("Relation requires a primary key on source table");
        }
        if (parentPk.kind === "boolean") {
          throw new Error(
            "Boolean primary keys are not supported for relation loading",
          );
        }

        let relatedRecords: Record<string, unknown>[] = [];

        if (parentPk.kind === "number") {
          const parentIds = [
            ...new Set(
              this.collectValuesByKind(rows, parentPk.key, "number").filter(
                (value) => value != null,
              ),
            ),
          ];

          if (parentIds.length === 0) continue;

          const where: AnyWhereClause = {
            [relation.fkColumn]: { in: parentIds },
          };

          relatedRecords = await relatedClient.findMany({ where });
        } else if (parentPk.kind === "string") {
          const parentIds = [
            ...new Set(
              this.collectValuesByKind(rows, parentPk.key, "string").filter(
                (value) => value != null,
              ),
            ),
          ];

          if (parentIds.length === 0) continue;

          const where: AnyWhereClause = {
            [relation.fkColumn]: { in: parentIds },
          };

          relatedRecords = await relatedClient.findMany({ where });
        } else {
          const parentIds = [
            ...new Set(
              this.collectValuesByKind(rows, parentPk.key, "date").filter(
                (value) => value != null,
              ),
            ),
          ];

          if (parentIds.length === 0) continue;

          const where: AnyWhereClause = {
            [relation.fkColumn]: { in: parentIds },
          };

          relatedRecords = await relatedClient.findMany({ where });
        }

        // Group related records by their FK value
        const relatedMap = new Map<unknown, unknown[]>();

        for (const record of relatedRecords) {
          const fkValue = Reflect.get(record, fkKey);

          if (!relatedMap.has(fkValue)) {
            relatedMap.set(fkValue, []);
          }

          const match = relatedMap.get(fkValue);

          if (match) match.push(record);
        }

        // Attach loaded relations to rows
        for (const row of rows) {
          const parentId = row[parentPk.key];
          row[relationName] = relatedMap.get(parentId) || [];
        }
      }
    }
  }

  public async findMany<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(
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
    this.mapColumnNames(rows);
    await this.loadIncludedRelations(
      rows,
      options?.include,
      this.getTableClient,
    );
    return rows as WithIncluded<InferTableType<T>, T, Inc>[];
  }

  public async findFirst<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(
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
    this.mapColumnNames(rows);
    await this.loadIncludedRelations(
      rows,
      options?.include,
      this.getTableClient,
    );
    return (
      (rows[0] as WithIncluded<InferTableType<T>, T, Inc> | undefined) ?? null
    );
  }

  public async findUnique<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(
    options: FindUniqueOptions<T> & { include?: Inc },
  ): Promise<WithIncluded<InferTableType<T>, T, Inc> | null> {
    // Runtime validation: ensure only unique/primary key columns are used
    const whereKeys = Object.keys(options.where);

    if (whereKeys.length === 0) {
      throw new Error(
        "findUnique requires at least one column in where clause",
      );
    }

    // Validate all columns exist and are either primary keys or unique columns
    for (const columnKey of whereKeys) {
      const column = this.table.columns[columnKey];

      if (!column) {
        throw new Error(`Invalid column: ${columnKey}`);
      }

      // Check if this column is a primary key or unique column
      if (!column.meta.primaryKey && !column.meta.unique) {
        throw new Error(
          `Column "${columnKey}" is not a primary key or unique column. findUnique requires a unique constraint.`,
        );
      }
    }

    const whereClause = this.buildWhereClause(options.where);

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
    this.mapColumnNames([result]);
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
    this.mapColumnNames(results);

    const [result] = results;
    if (!result) {
      throw new Error("create did not return a row");
    }

    return result;
  }

  public async update(options: UpdateOptions<T>): Promise<InferTableType<T>[]> {
    const whereClause = this.buildWhereClause(options.where);

    if (!whereClause) {
      throw new Error("update requires a where clause");
    }

    const dataEntries: [string, unknown][] = Object.entries(options.data);

    if (dataEntries.length === 0) {
      throw new Error("update requires at least one field in data");
    }

    // Build a map to translate JS field names to SQL column names
    const sqlData: Record<string, unknown> = {};
    for (const [key, value] of dataEntries) {
      const sqlColumnName = this.getSqlColumnName(key);
      sqlData[sqlColumnName] = value;
    }

    return await this.sql<InferTableType<T>[]>`
      UPDATE ${this.sql(this.table.sqlName)}
      SET ${this.sql(sqlData)}
      WHERE ${whereClause}
      RETURNING *
    `.then((results) => {
      this.convertBooleanValues(results);
      this.mapColumnNames(results);
      return results;
    });
  }

  public async delete(options: DeleteOptions<T>): Promise<number> {
    const whereClause = this.buildWhereClause(options.where);

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
