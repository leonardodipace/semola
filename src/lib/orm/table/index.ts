import { mightThrow } from "../../errors/index.js";
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
  private readonly connectionUrl: string;

  public constructor(
    sql: Bun.SQL,
    table: T,
    dialect: Dialect,
    connectionUrl: string,
    relations?: Record<string, Relation>,
    getTableClient?: (relation: Relation) => TableClient<Table> | undefined,
  ) {
    this.sql = sql;
    this.table = table;
    this.dialect = dialect;
    this.connectionUrl = connectionUrl;
    this.relations = relations;
    this.getTableClient = getTableClient;
  }

  // Check if the actual database connection is MySQL (not just the dialect setting)
  // This allows testing with SQLite + dialect="mysql" without requiring MySQL transaction syntax
  private isActualMysql(): boolean {
    // Check URL patterns to detect actual database type
    // SQLite uses :memory: or file paths (ending in .db, .sqlite, or no protocol)
    // MySQL uses mysql:// protocol
    // Postgres uses postgres:// or postgresql:// protocol

    const url = this.connectionUrl.toLowerCase();

    // If it's :memory: or a file path, it's SQLite
    if (
      url === ":memory:" ||
      url.endsWith(".db") ||
      url.endsWith(".sqlite") ||
      !url.includes("://")
    ) {
      return false;
    }

    // If it starts with mysql://, it's real MySQL
    if (url.startsWith("mysql://")) {
      return true;
    }

    // Otherwise, not MySQL
    return false;
  }

  private validateColumnName(key: string) {
    const columnNames = Object.keys(this.table.columns);

    if (!columnNames.includes(key)) {
      throw new Error(`Invalid column: ${key}`);
    }
  }

  private normalizeDateValue(value: unknown) {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value === "number") {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
      return value;
    }

    if (typeof value === "string") {
      const numeric = Number(value);
      if (!Number.isNaN(numeric) && value.trim() !== "") {
        const numericDate = new Date(numeric);
        if (!Number.isNaN(numericDate.getTime())) {
          return numericDate;
        }
      }

      const parsedDate = new Date(value);
      if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
    }

    return value;
  }

  private normalizeValueForWrite(
    column: Column<ColumnKind, ColumnMeta>,
    value: unknown,
  ) {
    if (column.columnKind !== "date") {
      return value;
    }

    if (value === null) {
      return value;
    }

    if (this.dialect.name === "sqlite" && value instanceof Date) {
      return value.getTime();
    }

    return value;
  }

  private normalizeValueForWhere(
    column: Column<ColumnKind, ColumnMeta>,
    value: unknown,
  ) {
    if (column.columnKind !== "date") {
      return value;
    }

    if (value === null) {
      return value;
    }

    if (this.dialect.name === "sqlite" && value instanceof Date) {
      return value.getTime();
    }

    return value;
  }

  private convertDateValues(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      for (const [_key, column] of Object.entries(this.table.columns)) {
        if (column.columnKind !== "date") {
          continue;
        }

        const sqlColumnName = column.sqlName;
        row[sqlColumnName] = this.normalizeDateValue(row[sqlColumnName]);
      }
    }
  }

  private normalizeRelationKey(value: unknown) {
    if (value instanceof Date) {
      return value.getTime();
    }

    return value;
  }

  private extractUniqueSelector(where: WhereClause<T>, operation: string) {
    const whereEntries: [string, unknown][] = Object.entries(where);

    if (whereEntries.length !== 1) {
      throw new Error(
        `${operation} requires a unique selector with exactly one column`,
      );
    }

    const [entry] = whereEntries;
    if (!entry) {
      throw new Error(
        `${operation} requires a unique selector with exactly one column`,
      );
    }

    const [key, rawValue] = entry;
    this.validateColumnName(key);

    const column = this.table.columns[key];
    if (!column) {
      throw new Error(`Invalid column: ${key}`);
    }

    if (!column.meta.primaryKey && !column.meta.unique) {
      throw new Error(
        `${operation} requires a unique selector on a primary key or unique column`,
      );
    }

    let value = rawValue;

    if (this.isFilterObject(rawValue)) {
      const filters = rawValue as Record<string, unknown>;
      const filterKeys = Object.keys(filters);

      if (filterKeys.length !== 1 || !("equals" in filters)) {
        throw new Error(
          `${operation} unique selector must use a direct value or { equals: value }`,
        );
      }

      value = filters.equals;
    }

    value = this.normalizeValueForWhere(column, value);

    return {
      key,
      value,
      column,
      isPrimaryKey: column.meta.primaryKey,
    };
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

  private isFilterObject(value: unknown) {
    return (
      typeof value === "object" &&
      value !== null &&
      !(value instanceof Date) &&
      !Array.isArray(value)
    );
  }

  private buildCondition(key: string, value: unknown) {
    const sqlColumnName = this.getSqlColumnName(key);
    const column = this.table.columns[key];

    if (!column) {
      throw new Error(`Invalid column: ${key}`);
    }

    if (value === null) {
      return this.sql`${this.sql(sqlColumnName)} IS NULL`;
    }

    // Check if value is a filter object (has operator properties)
    if (this.isFilterObject(value)) {
      const filters = value as Record<string, unknown>;
      const conditions = [];

      // Equality operator
      if ("equals" in filters) {
        const equalsValue = this.normalizeValueForWhere(column, filters.equals);
        conditions.push(this.sql`${this.sql(sqlColumnName)} = ${equalsValue}`);
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
        const gtValue = this.normalizeValueForWhere(column, filters.gt);
        conditions.push(this.sql`${this.sql(sqlColumnName)} > ${gtValue}`);
      }
      if ("gte" in filters) {
        const gteValue = this.normalizeValueForWhere(column, filters.gte);
        conditions.push(this.sql`${this.sql(sqlColumnName)} >= ${gteValue}`);
      }
      if ("lt" in filters) {
        const ltValue = this.normalizeValueForWhere(column, filters.lt);
        conditions.push(this.sql`${this.sql(sqlColumnName)} < ${ltValue}`);
      }
      if ("lte" in filters) {
        const lteValue = this.normalizeValueForWhere(column, filters.lte);
        conditions.push(this.sql`${this.sql(sqlColumnName)} <= ${lteValue}`);
      }

      // Handle 'in' operator
      if ("in" in filters && Array.isArray(filters.in)) {
        const inValues = filters.in.map((entry) =>
          this.normalizeValueForWhere(column, entry),
        );
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
    const normalizedValue = this.normalizeValueForWhere(column, value);
    return this.sql`${this.sql(sqlColumnName)} = ${normalizedValue}`;
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
      if (this.dialect.name === "sqlite") {
        return this.sql`LIMIT -1 OFFSET ${skip}`;
      }
      if (this.dialect.name === "postgres") {
        return this.sql`LIMIT ALL OFFSET ${skip}`;
      }
      if (this.dialect.name === "mysql") {
        // For MySQL without LIMIT, use max uint64 as numeric literal
        return this.sql`LIMIT 18446744073709551615 OFFSET ${skip}`;
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
        .filter((value) => typeof value === "number");
    }

    if (kind === "string") {
      return rows
        .map((row) => row[columnKey])
        .filter((value) => typeof value === "string");
    }

    if (kind === "date") {
      return rows
        .map((row) => row[columnKey])
        .filter((value) => value instanceof Date);
    }

    return rows
      .map((row) => row[columnKey])
      .filter((value) => typeof value === "boolean");
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
      if (!relation) {
        throw new Error(`Unknown relation in include: ${relationName}`);
      }

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

          const [, records] = await relatedClient.findMany({ where });
          relatedRecords = records ?? [];
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

          const [, records] = await relatedClient.findMany({ where });
          relatedRecords = records ?? [];
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

          const [, records] = await relatedClient.findMany({ where });
          relatedRecords = records ?? [];
        }

        // Build map for quick lookup
        const relatedMap = new Map<unknown, unknown>();
        for (const record of relatedRecords) {
          if (typeof record !== "object" || record === null) continue;
          const value = Reflect.get(record, relatedPk.key);
          if (value == null) continue;
          relatedMap.set(this.normalizeRelationKey(value), record);
        }

        // Attach loaded relations to rows
        for (const row of rows) {
          const fkValue = row[fkKey];
          row[relationName] =
            fkValue != null
              ? relatedMap.get(this.normalizeRelationKey(fkValue))
              : undefined;
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

          const [, records] = await relatedClient.findMany({ where });
          relatedRecords = records ?? [];
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

          const [, records] = await relatedClient.findMany({ where });
          relatedRecords = records ?? [];
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

          const [, records] = await relatedClient.findMany({ where });
          relatedRecords = records ?? [];
        }

        // Group related records by their FK value
        const relatedMap = new Map<unknown, unknown[]>();

        for (const record of relatedRecords) {
          const fkValue = Reflect.get(record, fkKey);
          const normalizedFkValue = this.normalizeRelationKey(fkValue);

          if (!relatedMap.has(normalizedFkValue)) {
            relatedMap.set(normalizedFkValue, []);
          }

          const match = relatedMap.get(normalizedFkValue);

          if (match) match.push(record);
        }

        // Attach loaded relations to rows
        for (const row of rows) {
          const parentId = row[parentPk.key];
          row[relationName] =
            relatedMap.get(this.normalizeRelationKey(parentId)) || [];
        }
      }
    }
  }

  public async findMany<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(options?: FindManyOptions<T> & { include?: Inc }) {
    return await mightThrow(
      (async () => {
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
        this.convertDateValues(rows);
        this.mapColumnNames(rows);
        await this.loadIncludedRelations(
          rows,
          options?.include,
          this.getTableClient,
        );
        // TypeScript can't track type changes from mutation helper loadIncludedRelations,
        // but we know the rows now conform to WithIncluded after the mutation
        return rows as WithIncluded<InferTableType<T>, T, Inc>[];
      })(),
    );
  }

  public async findFirst<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(options?: FindFirstOptions<T> & { include?: Inc }) {
    return await mightThrow(
      (async () => {
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

        const [row] = await sql;
        if (!row) return null;

        const rows = [row];
        this.convertBooleanValues(rows);
        this.convertDateValues(rows);
        this.mapColumnNames(rows);
        await this.loadIncludedRelations(
          rows,
          options?.include,
          this.getTableClient,
        );
        // TypeScript can't track type changes from mutation helper loadIncludedRelations,
        // but rows[0] now conforms to WithIncluded after the mutation
        return (
          (rows[0] as WithIncluded<InferTableType<T>, T, Inc> | undefined) ??
          null
        );
      })(),
    );
  }

  public async findUnique<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(options: FindUniqueOptions<T> & { include?: Inc }) {
    return await mightThrow(
      (async () => {
        const whereKeys = Object.keys(options.where);

        if (whereKeys.length !== 1) {
          throw new Error(
            "findUnique requires exactly one unique column in where clause",
          );
        }

        const [columnKey] = whereKeys;
        if (!columnKey) {
          throw new Error(
            "findUnique requires exactly one unique column in where clause",
          );
        }

        const column = this.table.columns[columnKey];

        if (!column) {
          throw new Error(`Invalid column: ${columnKey}`);
        }

        if (!column.meta.primaryKey && !column.meta.unique) {
          throw new Error(
            `Column "${columnKey}" is not a primary key or unique column. findUnique requires a unique constraint.`,
          );
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
        this.convertDateValues([result]);
        this.mapColumnNames([result]);
        await this.loadIncludedRelations(
          [result],
          options?.include,
          this.getTableClient,
        );
        // TypeScript can't track type changes from mutation helper loadIncludedRelations,
        // but result now conforms to WithIncluded after the mutation
        return result as WithIncluded<InferTableType<T>, T, Inc>;
      })(),
    );
  }

  public async create(data: CreateInput<T>) {
    return await mightThrow(
      (async () => {
        if (Object.keys(data).length === 0) {
          throw new Error("create requires at least one field");
        }

        // Build a map to translate JS field names to SQL column names
        const sqlData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
          this.validateColumnName(key);
          const column = this.table.columns[key];
          if (!column) {
            throw new Error(`Invalid column: ${key}`);
          }
          const sqlColumnName = column.sqlName;
          sqlData[sqlColumnName] = this.normalizeValueForWrite(column, value);
        }

        // Use dialect-specific SQL generation
        const query = this.dialect.buildInsert({
          tableName: this.table.sqlName,
          values: sqlData,
        });

        const inserted = await this.sql.unsafe<InferTableType<T>[]>(
          query.sql,
          query.params,
        );

        let results = inserted;

        if (this.dialect.name === "mysql") {
          const primaryKey = this.getPrimaryKeyColumn();

          if (primaryKey && primaryKey.kind !== "boolean") {
            if (this.isActualMysql()) {
              results = await this.sql<InferTableType<T>[]>`
                SELECT * FROM ${this.sql(this.table.sqlName)}
                WHERE ${this.sql(primaryKey.sqlName)} = LAST_INSERT_ID()
                LIMIT 1
              `;
            } else {
              results = await this.sql<InferTableType<T>[]>`
                SELECT * FROM ${this.sql(this.table.sqlName)}
                WHERE ${this.sql(primaryKey.sqlName)} = last_insert_rowid()
                LIMIT 1
              `;
            }
          }

          if (results.length === 0) {
            for (const [key, column] of Object.entries(this.table.columns)) {
              if (!column.meta.primaryKey && !column.meta.unique) {
                continue;
              }

              const value = Reflect.get(data, key);
              if (value === undefined) {
                continue;
              }

              const normalizedValue = this.normalizeValueForWhere(
                column,
                value,
              );

              results = await this.sql<InferTableType<T>[]>`
                SELECT * FROM ${this.sql(this.table.sqlName)}
                WHERE ${this.sql(column.sqlName)} = ${normalizedValue}
                LIMIT 1
              `;

              if (results.length > 0) {
                break;
              }
            }
          }
        }

        this.convertBooleanValues(results);
        this.convertDateValues(results);
        this.mapColumnNames(results);

        const [result] = results;
        if (!result) {
          throw new Error("create did not return a row");
        }

        // Type-safe return without assertion - TypeScript tracks the array element type
        const typedResult: InferTableType<T> = result;
        return typedResult;
      })(),
    );
  }

  public async update(options: UpdateOptions<T>) {
    return await mightThrow(
      (async () => {
        const uniqueSelector = this.extractUniqueSelector(
          options.where,
          "update",
        );

        const whereClause = this.buildCondition(
          uniqueSelector.key,
          uniqueSelector.value,
        );

        const dataEntries: [string, unknown][] = Object.entries(options.data);

        if (dataEntries.length === 0) {
          throw new Error("update requires at least one field in data");
        }

        // Build a map to translate JS field names to SQL column names
        const sqlData: Record<string, unknown> = {};
        for (const [key, value] of dataEntries) {
          this.validateColumnName(key);
          const column = this.table.columns[key];
          if (!column) {
            throw new Error(`Invalid column: ${key}`);
          }
          const sqlColumnName = column.sqlName;
          sqlData[sqlColumnName] = this.normalizeValueForWrite(column, value);
        }

        // Build the UPDATE query with proper dialect handling
        const hasReturning = this.dialect.name !== "mysql";

        let results: InferTableType<T>[];

        if (hasReturning) {
          const sql = this.sql<InferTableType<T>[]>`
            UPDATE ${this.sql(this.table.sqlName)}
            SET ${this.sql(sqlData)}
            WHERE ${whereClause}
            RETURNING *
          `;
          results = await sql;
        } else if (this.isActualMysql()) {
          // For real MySQL: wrap in transaction with SELECT FOR UPDATE to prevent races
          try {
            await this.sql`BEGIN`;

            const existingRows = await this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${whereClause}
              FOR UPDATE
            `;

            const [existing] = existingRows;
            if (!existing) {
              await this.sql`ROLLBACK`;
              throw new Error("update did not find a row");
            }

            await this.sql`
              UPDATE ${this.sql(this.table.sqlName)}
              SET ${this.sql(sqlData)}
              WHERE ${whereClause}
            `;

            const primaryKey = this.getPrimaryKeyColumn();
            if (primaryKey && primaryKey.kind !== "boolean") {
              const pkValue = existing[primaryKey.sqlName];
              results = await this.sql<InferTableType<T>[]>`
                SELECT * FROM ${this.sql(this.table.sqlName)}
                WHERE ${this.sql(primaryKey.sqlName)} = ${pkValue}
                LIMIT 1
              `;
            } else {
              const selectorColumn = uniqueSelector.column;
              const updatedSelectorValue =
                uniqueSelector.key in options.data
                  ? this.normalizeValueForWhere(
                      selectorColumn,
                      Reflect.get(options.data, uniqueSelector.key),
                    )
                  : uniqueSelector.value;

              results = await this.sql<InferTableType<T>[]>`
                SELECT * FROM ${this.sql(this.table.sqlName)}
                WHERE ${this.sql(selectorColumn.sqlName)} = ${updatedSelectorValue}
                LIMIT 1
              `;
            }

            await this.sql`COMMIT`;
          } catch (error) {
            await this.sql`ROLLBACK`;
            throw error;
          }
        } else {
          const existingRows = await this.sql<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
            LIMIT 1
          `;

          const [existing] = existingRows;
          if (!existing) {
            throw new Error("update did not find a row");
          }

          await this.sql`
            UPDATE ${this.sql(this.table.sqlName)}
            SET ${this.sql(sqlData)}
            WHERE ${whereClause}
          `;

          const primaryKey = this.getPrimaryKeyColumn();
          if (primaryKey && primaryKey.kind !== "boolean") {
            const pkValue = existing[primaryKey.sqlName];
            results = await this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${this.sql(primaryKey.sqlName)} = ${pkValue}
              LIMIT 1
            `;
          } else {
            const selectorColumn = uniqueSelector.column;
            const updatedSelectorValue =
              uniqueSelector.key in options.data
                ? this.normalizeValueForWhere(
                    selectorColumn,
                    Reflect.get(options.data, uniqueSelector.key),
                  )
                : uniqueSelector.value;

            results = await this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${this.sql(selectorColumn.sqlName)} = ${updatedSelectorValue}
              LIMIT 1
            `;
          }
        }

        this.convertBooleanValues(results);
        this.convertDateValues(results);
        this.mapColumnNames(results);

        const [result] = results;
        if (!result) {
          throw new Error("update did not return a row");
        }

        const typedResult: InferTableType<T> = result;
        return typedResult;
      })(),
    );
  }

  public async delete(options: DeleteOptions<T>) {
    return await mightThrow(
      (async () => {
        const uniqueSelector = this.extractUniqueSelector(
          options.where,
          "delete",
        );

        const whereClause = this.buildCondition(
          uniqueSelector.key,
          uniqueSelector.value,
        );

        // Build the DELETE query with proper dialect handling
        const hasReturning = this.dialect.name !== "mysql";

        let results: InferTableType<T>[];

        if (hasReturning) {
          const sql = this.sql<InferTableType<T>[]>`
            DELETE FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
            RETURNING *
          `;
          results = await sql;
        } else if (this.isActualMysql()) {
          // For MySQL: wrap in transaction with SELECT FOR UPDATE to prevent races
          try {
            await this.sql`BEGIN`;

            // Lock and fetch the rows we're about to delete
            results = await this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${whereClause}
              FOR UPDATE
            `;

            if (results.length === 0) {
              await this.sql`ROLLBACK`;
              throw new Error("delete did not find a row");
            }

            // Execute DELETE
            await this.sql`
              DELETE FROM ${this.sql(this.table.sqlName)}
              WHERE ${whereClause}
            `;

            await this.sql`COMMIT`;
          } catch (error) {
            await this.sql`ROLLBACK`;
            throw error;
          }
        } else {
          // For SQLite with MySQL dialect (testing): SELECT before DELETE
          results = await this.sql<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
          `;

          if (results.length === 0) {
            throw new Error("delete did not find a row");
          }

          await this.sql`
            DELETE FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
          `;
        }

        this.convertBooleanValues(results);
        this.convertDateValues(results);
        this.mapColumnNames(results);

        const [result] = results;
        if (!result) {
          throw new Error("delete did not return a row");
        }

        const typedResult: InferTableType<T> = result;
        return typedResult;
      })(),
    );
  }
}
