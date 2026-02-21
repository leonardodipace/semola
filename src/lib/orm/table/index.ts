import { err, mightThrow, ok } from "../../errors/index.js";
import type { Column } from "../column/index.js";
import type { ColumnKind, ColumnMeta } from "../column/types.js";
import type { Dialect } from "../dialect/types.js";
import type { Relation, WithIncluded } from "../relations/types.js";
import type {
  BooleanFilter,
  CountOptions,
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
  UpsertOptions,
  WhereClause,
} from "./types.js";

// Re-export WithIncluded from relations
export type { WithIncluded } from "../relations/types.js";
export type {
  BooleanFilter,
  CountOptions,
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
  UpsertOptions,
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
  private isActualMysql() {
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
      return err("ValidationError", `Invalid column: ${key}`);
    }

    return ok(undefined);
  }

  private toErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private normalizeTupleError(
    error: unknown,
    fallbackType = "InternalServerError",
  ) {
    if (typeof error === "object" && error !== null) {
      const type = Reflect.get(error, "type");
      const message = Reflect.get(error, "message");

      if (typeof type === "string" && typeof message === "string") {
        return { type, message };
      }
    }

    return { type: fallbackType, message: this.toErrorMessage(error) };
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

  private normalizeDateForStorage(
    column: Column<ColumnKind, ColumnMeta>,
    value: unknown,
  ) {
    if (column.columnKind !== "date" || value === null) {
      return value;
    }

    if (this.dialect.name === "sqlite" && value instanceof Date) {
      return value.getTime();
    }

    return value;
  }

  private normalizeRows(rows: Record<string, unknown>[]) {
    this.convertBooleanValues(rows);
    this.convertDateValues(rows);
    this.mapColumnNames(rows);
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
      return err(
        "ValidationError",
        `${operation} requires a unique selector with exactly one column`,
      );
    }

    const [entry] = whereEntries;
    if (!entry) {
      return err(
        "ValidationError",
        `${operation} requires a unique selector with exactly one column`,
      );
    }

    const [key, rawValue] = entry;
    const [nameError] = this.validateColumnName(key);
    if (nameError) {
      return err(nameError.type, nameError.message);
    }

    const column = this.table.columns[key];
    if (!column) {
      return err("ValidationError", `Invalid column: ${key}`);
    }

    if (!column.meta.primaryKey && !column.meta.unique) {
      return err(
        "ValidationError",
        `${operation} requires a unique selector on a primary key or unique column`,
      );
    }

    let value = rawValue;

    if (this.isFilterObject(rawValue)) {
      const filters = rawValue;
      const filterKeys = Object.keys(filters);

      if (filterKeys.length !== 1 || !("equals" in filters)) {
        return err(
          "ValidationError",
          `${operation} unique selector must use a direct value or { equals: value }`,
        );
      }

      value = filters.equals;
    }

    value = this.normalizeDateForStorage(column, value);

    return ok({
      key,
      value,
      column,
      isPrimaryKey: column.meta.primaryKey,
    });
  }

  public getSqlColumnName(key: string) {
    const column = this.table.columns[key];
    if (!column) {
      return err("ValidationError", `Invalid column: ${key}`);
    }
    return ok(column.sqlName);
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

  private escapeLikePattern(value: string) {
    return value
      .replaceAll("\\", "\\\\")
      .replaceAll("%", "\\%")
      .replaceAll("_", "\\_");
  }

  private buildCondition(key: string, value: unknown) {
    const [columnNameError, sqlColumnName] = this.getSqlColumnName(key);
    if (columnNameError || !sqlColumnName) {
      return err(
        columnNameError?.type ?? "ValidationError",
        columnNameError?.message ?? `Invalid column: ${key}`,
      );
    }

    const column = this.table.columns[key];

    if (!column) {
      return err("ValidationError", `Invalid column: ${key}`);
    }

    if (value === null) {
      return ok(this.sql`${this.sql(sqlColumnName)} IS NULL`);
    }

    // Check if value is a filter object (has operator properties)
    if (this.isFilterObject(value)) {
      const filters = value;
      const conditions: unknown[] = [];

      // Equality operator
      if ("equals" in filters) {
        const equalsValue = this.normalizeDateForStorage(
          column,
          filters.equals,
        );
        conditions.push(this.sql`${this.sql(sqlColumnName)} = ${equalsValue}`);
      }

      // String operators (case-insensitive, works across all databases)
      if ("contains" in filters && typeof filters.contains === "string") {
        const searchValue = this.escapeLikePattern(filters.contains);
        conditions.push(
          this
            .sql`LOWER(${this.sql(sqlColumnName)}) LIKE LOWER(${`%${searchValue}%`}) ESCAPE '\\'`,
        );
      }

      // Number/Date comparison operators
      if ("gt" in filters) {
        const gtValue = this.normalizeDateForStorage(column, filters.gt);
        conditions.push(this.sql`${this.sql(sqlColumnName)} > ${gtValue}`);
      }
      if ("gte" in filters) {
        const gteValue = this.normalizeDateForStorage(column, filters.gte);
        conditions.push(this.sql`${this.sql(sqlColumnName)} >= ${gteValue}`);
      }
      if ("lt" in filters) {
        const ltValue = this.normalizeDateForStorage(column, filters.lt);
        conditions.push(this.sql`${this.sql(sqlColumnName)} < ${ltValue}`);
      }
      if ("lte" in filters) {
        const lteValue = this.normalizeDateForStorage(column, filters.lte);
        conditions.push(this.sql`${this.sql(sqlColumnName)} <= ${lteValue}`);
      }

      // Handle 'in' operator
      if ("in" in filters && Array.isArray(filters.in)) {
        const inValues = filters.in.map((entry) =>
          this.normalizeDateForStorage(column, entry),
        );
        if (inValues.length === 0) {
          conditions.push(this.sql`FALSE`);
        } else if (inValues.length === 1) {
          conditions.push(
            this.sql`${this.sql(sqlColumnName)} = ${inValues[0]}`,
          );
        } else {
          conditions.push(
            this.sql`${this.sql(sqlColumnName)} IN ${this.sql(inValues)}`,
          );
        }
      }

      // Combine multiple operators with AND
      if (conditions.length === 0) {
        return err(
          "ValidationError",
          `No valid operators found for column: ${key}`,
        );
      }

      const [firstCondition] = conditions;

      let combined = firstCondition;

      for (let i = 1; i < conditions.length; i++) {
        combined = this.sql`${combined} AND ${conditions[i]}`;
      }

      return ok(combined);
    }

    // Direct equality
    const normalizedValue = this.normalizeDateForStorage(column, value);
    return ok(this.sql`${this.sql(sqlColumnName)} = ${normalizedValue}`);
  }

  private buildWhereClause(where?: WhereClause<T>) {
    if (!where) {
      return ok(null);
    }

    const whereEntries: [string, unknown][] = Object.entries(where);

    if (whereEntries.length === 0) {
      return ok(null);
    }

    // Validate all column names first
    for (const [key] of whereEntries) {
      const [nameError] = this.validateColumnName(key);
      if (nameError) {
        return err(nameError.type, nameError.message);
      }
    }

    // Build the first condition
    const [firstEntry] = whereEntries;

    if (!firstEntry) {
      return ok(null);
    }

    const [firstKey, firstValue] = firstEntry;

    const [firstConditionError, firstCondition] = this.buildCondition(
      firstKey,
      firstValue,
    );
    if (firstConditionError || !firstCondition) {
      return err(
        firstConditionError?.type ?? "ValidationError",
        firstConditionError?.message ?? `Invalid column: ${firstKey}`,
      );
    }

    let whereClause = firstCondition;

    // Add remaining conditions with AND
    for (let i = 1; i < whereEntries.length; i++) {
      const [key, value] = whereEntries[i] ?? [];
      if (!key) continue;
      const [conditionError, condition] = this.buildCondition(key, value);
      if (conditionError || !condition) {
        return err(
          conditionError?.type ?? "ValidationError",
          conditionError?.message ?? `Invalid column: ${key}`,
        );
      }

      whereClause = this.sql`${whereClause} AND ${condition}`;
    }

    return ok(whereClause);
  }

  private buildPagination(skip: number, take: number | undefined) {
    if (skip === 0 && take === undefined) {
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

  private collectRelationValues(
    rows: Record<string, unknown>[],
    key: string,
  ): unknown[] {
    return [...new Set(rows.map((row) => row[key]).filter((v) => v != null))];
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

  private async loadIncludedRelations<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(
    rows: WithIncluded<InferTableType<T>, T, Inc>[],
    include?: Inc,
    getTableClient?: (relation: Relation) => TableClient<Table> | undefined,
  ) {
    if (!include || !this.relations || !getTableClient || rows.length === 0) {
      return ok(rows);
    }

    // Iterate over includes and check if relation exists in table
    for (const [relationName, shouldInclude] of Object.entries(include)) {
      if (!shouldInclude) continue;

      const relation = this.relations[relationName];
      if (!relation) {
        return err(
          "ValidationError",
          `Unknown relation in include: ${relationName}`,
        );
      }

      const relatedClient = getTableClient(relation);
      if (!relatedClient) {
        return err(
          "ValidationError",
          `Missing table client for relation: ${relationName}`,
        );
      }

      if (relation.type === "one") {
        // one() relation: parent has FK pointing to child
        // Use TypeScript key directly since rows are already mapped
        const fkKey = relation.fkColumn;

        const relatedPk = relatedClient.getPrimaryKeyColumn();
        if (!relatedPk) {
          return err(
            "ValidationError",
            "Relation requires a primary key on related table",
          );
        }
        if (relatedPk.kind === "boolean") {
          return err(
            "ValidationError",
            "Boolean primary keys are not supported for relation loading",
          );
        }

        const fkValues = this.collectRelationValues(rows, fkKey);

        if (fkValues.length === 0) continue;

        const oneWhere = {
          [relatedPk.key]: { in: fkValues },
        } as AnyWhereClause;

        const [relatedError, relatedRecords] = await relatedClient.findMany({
          where: oneWhere,
        });
        if (relatedError) {
          const normalizedError = this.normalizeTupleError(relatedError);
          return err(normalizedError.type, normalizedError.message);
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
          return err(
            "ValidationError",
            "Relation requires a primary key on source table",
          );
        }
        if (parentPk.kind === "boolean") {
          return err(
            "ValidationError",
            "Boolean primary keys are not supported for relation loading",
          );
        }

        const parentIds = this.collectRelationValues(rows, parentPk.key);

        if (parentIds.length === 0) continue;

        const manyWhere = {
          [relation.fkColumn]: { in: parentIds },
        } as AnyWhereClause;

        const [relatedError, relatedRecords] = await relatedClient.findMany({
          where: manyWhere,
        });
        if (relatedError) {
          const normalizedError = this.normalizeTupleError(relatedError);
          return err(normalizedError.type, normalizedError.message);
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

    return ok(rows);
  }

  public async findMany<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(options?: FindManyOptions<T> & { include?: Inc }) {
    const [whereError, whereClause] = this.buildWhereClause(options?.where);
    if (whereError) {
      return err(whereError.type, whereError.message);
    }

    const skip = options?.skip ?? 0;
    const take = options?.take;
    const pagination = this.buildPagination(skip, take);

    let sql = this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
    `;

    if (whereClause) {
      sql = this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
        ${sql}
        WHERE ${whereClause}
      `;
    }

    if (pagination) {
      sql = this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
        ${sql}
        ${pagination}
      `;
    }

    const [queryError, rows] = await mightThrow(sql);
    if (queryError || !rows) {
      return err(
        "InternalServerError",
        `Failed to fetch rows: ${this.toErrorMessage(queryError)}`,
      );
    }

    this.normalizeRows(rows);

    const [includeError, includedRows] = await this.loadIncludedRelations(
      rows,
      options?.include,
      this.getTableClient,
    );
    if (includeError || !includedRows) {
      return err(
        includeError?.type ?? "InternalServerError",
        includeError?.message ?? "Failed to load included relations",
      );
    }

    return ok(includedRows);
  }

  public async findFirst<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(options?: FindFirstOptions<T> & { include?: Inc }) {
    const [whereError, whereClause] = this.buildWhereClause(options?.where);
    if (whereError) {
      return err(whereError.type, whereError.message);
    }

    let sql = this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
    `;

    if (whereClause) {
      sql = this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
        ${sql}
        WHERE ${whereClause}
      `;
    }

    sql = this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
      ${sql}
      LIMIT 1
    `;

    const [queryError, queryRows] = await mightThrow(sql);
    if (queryError || !queryRows) {
      return err(
        "InternalServerError",
        `Failed to fetch row: ${this.toErrorMessage(queryError)}`,
      );
    }

    const [row] = queryRows;
    if (!row) {
      return ok(null);
    }

    const rows = [row];
    this.normalizeRows(rows);

    const [includeError, includedRows] = await this.loadIncludedRelations(
      rows,
      options?.include,
      this.getTableClient,
    );
    if (includeError || !includedRows) {
      return err(
        includeError?.type ?? "InternalServerError",
        includeError?.message ?? "Failed to load included relations",
      );
    }

    return ok(includedRows[0] ?? null);
  }

  public async findUnique<
    Inc extends Record<string, boolean> | undefined = undefined,
  >(options: FindUniqueOptions<T> & { include?: Inc }) {
    const [uniqueError] = this.extractUniqueSelector(
      options.where,
      "findUnique",
    );
    if (uniqueError) {
      return err(uniqueError.type, uniqueError.message);
    }

    const [whereError, whereClause] = this.buildWhereClause(options.where);
    if (whereError) {
      return err(whereError.type, whereError.message);
    }

    if (!whereClause) {
      return err("ValidationError", "findUnique requires a where clause");
    }

    const [queryError, results] = await mightThrow(
      this.sql<WithIncluded<InferTableType<T>, T, Inc>[]>`
        SELECT * FROM ${this.sql(this.table.sqlName)}
        WHERE ${whereClause}
        LIMIT 1
      `,
    );
    if (queryError || !results) {
      return err(
        "InternalServerError",
        `Failed to fetch row: ${this.toErrorMessage(queryError)}`,
      );
    }

    const result = results[0];
    if (!result) {
      return ok(null);
    }

    this.normalizeRows([result]);

    const [includeError, includedRows] = await this.loadIncludedRelations(
      [result],
      options?.include,
      this.getTableClient,
    );
    if (includeError || !includedRows) {
      return err(
        includeError?.type ?? "InternalServerError",
        includeError?.message ?? "Failed to load included relations",
      );
    }

    const [included] = includedRows;
    return ok(included ?? null);
  }

  public async count(options?: CountOptions<T>) {
    const [whereError, whereClause] = this.buildWhereClause(options?.where);
    if (whereError) {
      return err(whereError.type, whereError.message);
    }

    const baseQuery = this.sql<{ count: number }[]>`
      SELECT COUNT(*) AS count FROM ${this.sql(this.table.sqlName)}
    `;
    const query = whereClause
      ? this.sql<{ count: number }[]>`${baseQuery} WHERE ${whereClause}`
      : baseQuery;

    const [queryError, rows] = await mightThrow(query);
    if (queryError || !rows) {
      return err(
        "InternalServerError",
        `Failed to count rows: ${this.toErrorMessage(queryError)}`,
      );
    }

    return ok(Number(rows[0]?.count ?? 0));
  }

  public async create(data: CreateInput<T>) {
    if (Object.keys(data).length === 0) {
      return err("ValidationError", "create requires at least one field");
    }

    const sqlData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const [nameError] = this.validateColumnName(key);
      if (nameError) {
        return err(nameError.type, nameError.message);
      }

      const column = this.table.columns[key];
      if (!column) {
        return err("ValidationError", `Invalid column: ${key}`);
      }

      const sqlColumnName = column.sqlName;
      sqlData[sqlColumnName] = this.normalizeDateForStorage(column, value);
    }

    let results: InferTableType<T>[];

    if (this.dialect.name === "mysql") {
      const [insertError] = await mightThrow(
        this
          .sql`INSERT INTO ${this.sql(this.table.sqlName)} ${this.sql(sqlData)}`,
      );
      if (insertError) {
        return err(
          "InternalServerError",
          `Failed to create row: ${this.toErrorMessage(insertError)}`,
        );
      }
      results = [];
    } else {
      const [insertError, inserted] = await mightThrow(
        this.sql<
          InferTableType<T>[]
        >`INSERT INTO ${this.sql(this.table.sqlName)} ${this.sql(sqlData)} RETURNING *`,
      );
      if (insertError || !inserted) {
        return err(
          "InternalServerError",
          `Failed to create row: ${this.toErrorMessage(insertError)}`,
        );
      }
      results = inserted;
    }

    if (this.dialect.name === "mysql") {
      const primaryKey = this.getPrimaryKeyColumn();

      if (primaryKey && primaryKey.kind !== "boolean") {
        if (this.isActualMysql()) {
          const [readError, readResults] = await mightThrow(
            this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${this.sql(primaryKey.sqlName)} = LAST_INSERT_ID()
              LIMIT 1
            `,
          );
          if (readError || !readResults) {
            return err(
              "InternalServerError",
              `Failed to load created row: ${this.toErrorMessage(readError)}`,
            );
          }
          results = readResults;
        } else {
          const [readError, readResults] = await mightThrow(
            this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${this.sql(primaryKey.sqlName)} = last_insert_rowid()
              LIMIT 1
            `,
          );
          if (readError || !readResults) {
            return err(
              "InternalServerError",
              `Failed to load created row: ${this.toErrorMessage(readError)}`,
            );
          }
          results = readResults;
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

          const normalizedValue = this.normalizeDateForStorage(column, value);
          const [readError, readResults] = await mightThrow(
            this.sql<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${this.sql(column.sqlName)} = ${normalizedValue}
              LIMIT 1
            `,
          );
          if (readError || !readResults) {
            return err(
              "InternalServerError",
              `Failed to load created row: ${this.toErrorMessage(readError)}`,
            );
          }

          results = readResults;

          if (results.length > 0) {
            break;
          }
        }
      }
    }

    this.normalizeRows(results);

    const [result] = results;
    if (!result) {
      return err("InternalServerError", "create did not return a row");
    }

    return ok(result);
  }

  public async createMany(data: CreateInput<T>[]) {
    if (data.length === 0) {
      return ok([] as InferTableType<T>[]);
    }

    const results: InferTableType<T>[] = [];

    for (const item of data) {
      const [createError, created] = await this.create(item);
      if (createError || !created) {
        return err(
          createError?.type ?? "InternalServerError",
          createError?.message ?? "createMany failed on an item",
        );
      }
      results.push(created);
    }

    return ok(results);
  }

  public async upsert(options: UpsertOptions<T>) {
    const [selectorError] = this.extractUniqueSelector(options.where, "upsert");
    if (selectorError) {
      return err(selectorError.type, selectorError.message);
    }

    const [findError, existing] = await this.findUnique({
      where: options.where,
    });
    if (findError) {
      return err(findError.type, findError.message);
    }

    if (existing) {
      return this.update({ where: options.where, data: options.update });
    }

    return this.create(options.create);
  }

  public async update(options: UpdateOptions<T>) {
    if (!options.where) {
      return err("ValidationError", "update requires a unique selector");
    }

    const [selectorError, uniqueSelector] = this.extractUniqueSelector(
      options.where,
      "update",
    );
    if (selectorError || !uniqueSelector) {
      return err(
        selectorError?.type ?? "ValidationError",
        selectorError?.message ?? "update requires a unique selector",
      );
    }

    const [whereError, whereClause] = this.buildCondition(
      uniqueSelector.key,
      uniqueSelector.value,
    );
    if (whereError || !whereClause) {
      return err(
        whereError?.type ?? "ValidationError",
        whereError?.message ?? "update requires a valid where clause",
      );
    }

    const dataEntries: [string, unknown][] = Object.entries(options.data);
    if (dataEntries.length === 0) {
      return err(
        "ValidationError",
        "update requires at least one field in data",
      );
    }

    const sqlData: Record<string, unknown> = {};
    for (const [key, value] of dataEntries) {
      const [nameError] = this.validateColumnName(key);
      if (nameError) {
        return err(nameError.type, nameError.message);
      }

      const column = this.table.columns[key];
      if (!column) {
        return err("ValidationError", `Invalid column: ${key}`);
      }

      const sqlColumnName = column.sqlName;
      sqlData[sqlColumnName] = this.normalizeDateForStorage(column, value);
    }

    const hasReturning = this.dialect.name !== "mysql";
    let results: InferTableType<T>[] = [];

    if (hasReturning) {
      const [updateError, updateResults] = await mightThrow(
        this.sql<InferTableType<T>[]>`
          UPDATE ${this.sql(this.table.sqlName)}
          SET ${this.sql(sqlData)}
          WHERE ${whereClause}
          RETURNING *
        `,
      );
      if (updateError || !updateResults) {
        return err(
          "InternalServerError",
          `Failed to update row: ${this.toErrorMessage(updateError)}`,
        );
      }
      results = updateResults;
    } else if (this.isActualMysql()) {
      const [txError, txResult] = await mightThrow(
        this.sql.begin(async (tx) => {
          const existingRows = await tx<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
            FOR UPDATE
          `;

          const [existing] = existingRows;
          if (!existing) {
            const empty: InferTableType<T>[] = [];
            return empty;
          }

          await tx`
            UPDATE ${this.sql(this.table.sqlName)}
            SET ${this.sql(sqlData)}
            WHERE ${whereClause}
          `;

          const primaryKey = this.getPrimaryKeyColumn();
          if (primaryKey && primaryKey.kind !== "boolean") {
            const pkValue = existing[primaryKey.sqlName];
            return await tx<InferTableType<T>[]>`
              SELECT * FROM ${this.sql(this.table.sqlName)}
              WHERE ${this.sql(primaryKey.sqlName)} = ${pkValue}
              LIMIT 1
            `;
          }

          const selectorColumn = uniqueSelector.column;
          const updatedSelectorValue =
            uniqueSelector.key in options.data
              ? this.normalizeDateForStorage(
                  selectorColumn,
                  Reflect.get(options.data, uniqueSelector.key),
                )
              : uniqueSelector.value;

          return await tx<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${this.sql(selectorColumn.sqlName)} = ${updatedSelectorValue}
            LIMIT 1
          `;
        }),
      );
      if (txError || !txResult) {
        return err(
          "InternalServerError",
          `Failed to update row: ${this.toErrorMessage(txError)}`,
        );
      }

      results = txResult;
    } else {
      const [existingError, existingRows] = await mightThrow(
        this.sql<InferTableType<T>[]>`
          SELECT * FROM ${this.sql(this.table.sqlName)}
          WHERE ${whereClause}
          LIMIT 1
        `,
      );
      if (existingError || !existingRows) {
        return err(
          "InternalServerError",
          `Failed to load row for update: ${this.toErrorMessage(existingError)}`,
        );
      }

      const [existing] = existingRows;
      if (!existing) {
        return err("NotFoundError", "update did not find a row");
      }

      const [writeError] = await mightThrow(
        this.sql`
          UPDATE ${this.sql(this.table.sqlName)}
          SET ${this.sql(sqlData)}
          WHERE ${whereClause}
        `,
      );
      if (writeError) {
        return err(
          "InternalServerError",
          `Failed to update row: ${this.toErrorMessage(writeError)}`,
        );
      }

      const primaryKey = this.getPrimaryKeyColumn();
      if (primaryKey && primaryKey.kind !== "boolean") {
        const pkValue = existing[primaryKey.sqlName];
        const [readError, readResults] = await mightThrow(
          this.sql<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${this.sql(primaryKey.sqlName)} = ${pkValue}
            LIMIT 1
          `,
        );
        if (readError || !readResults) {
          return err(
            "InternalServerError",
            `Failed to load updated row: ${this.toErrorMessage(readError)}`,
          );
        }
        results = readResults;
      } else {
        const selectorColumn = uniqueSelector.column;
        const updatedSelectorValue =
          uniqueSelector.key in options.data
            ? this.normalizeDateForStorage(
                selectorColumn,
                Reflect.get(options.data, uniqueSelector.key),
              )
            : uniqueSelector.value;

        const [readError, readResults] = await mightThrow(
          this.sql<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${this.sql(selectorColumn.sqlName)} = ${updatedSelectorValue}
            LIMIT 1
          `,
        );
        if (readError || !readResults) {
          return err(
            "InternalServerError",
            `Failed to load updated row: ${this.toErrorMessage(readError)}`,
          );
        }
        results = readResults;
      }
    }

    if (results.length === 0) {
      return err("NotFoundError", "update did not find a row");
    }

    this.normalizeRows(results);

    const [result] = results;
    if (!result) {
      return err("InternalServerError", "update did not return a row");
    }

    return ok(result);
  }

  public async delete(options: DeleteOptions<T>) {
    if (!options.where) {
      return err("ValidationError", "delete requires a unique selector");
    }

    const [selectorError, uniqueSelector] = this.extractUniqueSelector(
      options.where,
      "delete",
    );
    if (selectorError || !uniqueSelector) {
      return err(
        selectorError?.type ?? "ValidationError",
        selectorError?.message ?? "delete requires a unique selector",
      );
    }

    const [whereError, whereClause] = this.buildCondition(
      uniqueSelector.key,
      uniqueSelector.value,
    );
    if (whereError || !whereClause) {
      return err(
        whereError?.type ?? "ValidationError",
        whereError?.message ?? "delete requires a valid where clause",
      );
    }

    const hasReturning = this.dialect.name !== "mysql";
    let results: InferTableType<T>[] = [];

    if (hasReturning) {
      const [deleteError, deletedRows] = await mightThrow(
        this.sql<InferTableType<T>[]>`
          DELETE FROM ${this.sql(this.table.sqlName)}
          WHERE ${whereClause}
          RETURNING *
        `,
      );
      if (deleteError || !deletedRows) {
        return err(
          "InternalServerError",
          `Failed to delete row: ${this.toErrorMessage(deleteError)}`,
        );
      }
      results = deletedRows;
    } else if (this.isActualMysql()) {
      const [txError, txResult] = await mightThrow(
        this.sql.begin(async (tx) => {
          const existingRows = await tx<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
            FOR UPDATE
          `;

          if (existingRows.length === 0) {
            const empty: InferTableType<T>[] = [];
            return empty;
          }

          await tx`
            DELETE FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
          `;

          return existingRows;
        }),
      );
      if (txError || !txResult) {
        return err(
          "InternalServerError",
          `Failed to delete row: ${this.toErrorMessage(txError)}`,
        );
      }
      results = txResult;
    } else {
      const [existingError, existingRows] = await mightThrow(
        this.sql<InferTableType<T>[]>`
          SELECT * FROM ${this.sql(this.table.sqlName)}
          WHERE ${whereClause}
        `,
      );
      if (existingError || !existingRows) {
        return err(
          "InternalServerError",
          `Failed to load row for delete: ${this.toErrorMessage(existingError)}`,
        );
      }

      results = existingRows;
      if (results.length === 0) {
        return err("NotFoundError", "delete did not find a row");
      }

      const [deleteError] = await mightThrow(
        this.sql`
          DELETE FROM ${this.sql(this.table.sqlName)}
          WHERE ${whereClause}
        `,
      );
      if (deleteError) {
        return err(
          "InternalServerError",
          `Failed to delete row: ${this.toErrorMessage(deleteError)}`,
        );
      }
    }

    if (results.length === 0) {
      return err("NotFoundError", "delete did not find a row");
    }

    this.normalizeRows(results);

    const [result] = results;
    if (!result) {
      return err("InternalServerError", "delete did not return a row");
    }

    return ok(result);
  }
}
