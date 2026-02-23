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

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
    const url = this.connectionUrl.toLowerCase();

    if (
      url === ":memory:" ||
      url.endsWith(".db") ||
      url.endsWith(".sqlite") ||
      !url.includes("://")
    ) {
      return false;
    }

    return url.startsWith("mysql://");
  }

  private validateColumnName(key: string) {
    if (!Object.keys(this.table.columns).includes(key)) {
      return err("ValidationError", `Invalid column: ${key}`);
    }
    return ok(undefined);
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
    this.convertNumberValues(rows);
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
    const [firstEntry] = whereEntries;

    if (!firstEntry || whereEntries.length !== 1) {
      return err(
        "ValidationError",
        `${operation} requires a unique selector with exactly one column`,
      );
    }

    const [key, rawValue] = firstEntry;

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

    let value: unknown = rawValue;

    if (this.isFilterObject(rawValue)) {
      const filters = rawValue as Record<string, unknown>;

      if (Object.keys(filters).length !== 1 || !("equals" in filters)) {
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

  private isFilterObject(value: unknown) {
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

    if (this.isFilterObject(value)) {
      const filters = value as Record<string, unknown>;
      const conditions: unknown[] = [];

      if ("equals" in filters) {
        const equalsValue = this.normalizeDateForStorage(
          column,
          filters.equals,
        );
        conditions.push(this.sql`${this.sql(sqlColumnName)} = ${equalsValue}`);
      }

      if ("contains" in filters && typeof filters.contains === "string") {
        const searchValue = this.escapeLikePattern(filters.contains);
        conditions.push(
          this
            .sql`LOWER(${this.sql(sqlColumnName)}) LIKE LOWER(${`%${searchValue}%`}) ESCAPE '\\'`,
        );
      }

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

      if (conditions.length === 0) {
        return err(
          "ValidationError",
          `No valid operators found for column: ${key}`,
        );
      }

      const combined = conditions.reduce(
        (acc, cond) => this.sql`${acc} AND ${cond}`,
      );

      return ok(combined);
    }

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

    for (const [key] of whereEntries) {
      const [nameError] = this.validateColumnName(key);
      if (nameError) {
        return err(nameError.type, nameError.message);
      }
    }

    const conditions: unknown[] = [];
    for (const [key, value] of whereEntries) {
      const [condError, cond] = this.buildCondition(key, value);
      if (condError || !cond) {
        return err(
          condError?.type ?? "ValidationError",
          condError?.message ?? `Invalid column: ${key}`,
        );
      }
      conditions.push(cond);
    }

    const combined = conditions.reduce(
      (acc, cond) => this.sql`${acc} AND ${cond}`,
    );

    return ok(combined);
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

  private convertNumberValues(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      for (const [_key, column] of Object.entries(this.table.columns)) {
        if (column.columnKind !== "number") {
          continue;
        }

        const sqlColumnName = column.sqlName;
        const value = row[sqlColumnName];

        if (typeof value === "string") {
          const parsed = Number(value);
          if (!Number.isNaN(parsed)) {
            row[sqlColumnName] = parsed;
          }
        }
      }
    }
  }

  // Map SQL column names back to TypeScript property names
  private mapColumnNames(rows: Record<string, unknown>[]) {
    for (const row of rows) {
      for (const [key, column] of Object.entries(this.table.columns)) {
        const sqlColumnName = column.sqlName;

        if (sqlColumnName !== key && sqlColumnName in row) {
          row[key] = row[sqlColumnName];
          delete row[sqlColumnName];
        }
      }
    }
  }

  // Fetch related records by a set of FK values using a concrete (non-generic) client.
  // Typed concretely to break the circular type inference between findMany ↔ loadIncludedRelations.
  private async fetchRelated(
    client: TableClient<Table>,
    where: AnyWhereClause,
  ): Promise<
    | readonly [{ type: string; message: string }, null]
    | readonly [null, Record<string, unknown>[]]
  > {
    return client.findMany({ where });
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

        const [relatedError, relatedRecords] = await this.fetchRelated(
          relatedClient,
          { [relatedPk.key]: { in: fkValues } } as AnyWhereClause,
        );
        if (relatedError) {
          return err(relatedError.type, relatedError.message);
        }

        const relatedMap = new Map<unknown, unknown>();
        for (const record of relatedRecords) {
          if (typeof record !== "object" || record === null) continue;
          const value = Reflect.get(record, relatedPk.key);
          if (value == null) continue;
          relatedMap.set(this.normalizeRelationKey(value), record);
        }

        for (const row of rows) {
          const fkValue = row[fkKey];
          row[relationName] =
            fkValue != null
              ? relatedMap.get(this.normalizeRelationKey(fkValue))
              : undefined;
        }
      } else if (relation.type === "many") {
        // many() relation: child has FK pointing to parent
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

        const [relatedError, relatedRecords] = await this.fetchRelated(
          relatedClient,
          { [relation.fkColumn]: { in: parentIds } } as AnyWhereClause,
        );
        if (relatedError) {
          return err(relatedError.type, relatedError.message);
        }

        const relatedMap = new Map<unknown, unknown[]>();
        for (const record of relatedRecords) {
          const fkValue = Reflect.get(record, fkKey);
          const normalizedFkValue = this.normalizeRelationKey(fkValue);

          if (!relatedMap.has(normalizedFkValue)) {
            relatedMap.set(normalizedFkValue, []);
          }

          relatedMap.get(normalizedFkValue)?.push(record);
        }

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
        `Failed to fetch rows: ${toErrorMessage(queryError)}`,
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
        `Failed to fetch row: ${toErrorMessage(queryError)}`,
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
        `Failed to fetch row: ${toErrorMessage(queryError)}`,
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
        `Failed to count rows: ${toErrorMessage(queryError)}`,
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

      sqlData[column.sqlName] = this.normalizeDateForStorage(column, value);
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
          `Failed to create row: ${toErrorMessage(insertError)}`,
        );
      }

      results = await this.readLastInsertedRows(data, 1);
    } else {
      const [insertError, inserted] = await mightThrow(
        this.sql<
          InferTableType<T>[]
        >`INSERT INTO ${this.sql(this.table.sqlName)} ${this.sql(sqlData)} RETURNING *`,
      );
      if (insertError || !inserted) {
        return err(
          "InternalServerError",
          `Failed to create row: ${toErrorMessage(insertError)}`,
        );
      }
      results = inserted;
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

    const sqlDataArray: Record<string, unknown>[] = [];

    for (const item of data) {
      if (Object.keys(item).length === 0) {
        return err("ValidationError", "createMany requires at least one field");
      }

      const sqlData: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(item)) {
        const [nameError] = this.validateColumnName(key);
        if (nameError) {
          return err(nameError.type, nameError.message);
        }

        const column = this.table.columns[key];
        if (!column) {
          return err("ValidationError", `Invalid column: ${key}`);
        }

        sqlData[column.sqlName] = this.normalizeDateForStorage(column, value);
      }

      sqlDataArray.push(sqlData);
    }

    let results: InferTableType<T>[] = [];

    if (this.dialect.name === "mysql") {
      const [insertError] = await mightThrow(
        this
          .sql`INSERT INTO ${this.sql(this.table.sqlName)} ${this.sql(sqlDataArray)}`,
      );

      if (insertError) {
        return err(
          "InternalServerError",
          `Failed to create rows: ${toErrorMessage(insertError)}`,
        );
      }

      results = await this.queryInsertedRows(sqlDataArray.length);
    } else {
      const [insertError, inserted] = await mightThrow(
        this.sql<InferTableType<T>[]>`
          INSERT INTO ${this.sql(this.table.sqlName)} ${this.sql(sqlDataArray)}
          RETURNING *
        `,
      );

      if (insertError || !inserted) {
        return err(
          "InternalServerError",
          `Failed to create rows: ${toErrorMessage(insertError)}`,
        );
      }

      results = inserted;
    }

    this.normalizeRows(results);
    return ok(results);
  }

  // Read the last N inserted rows by primary key range (MySQL workaround for RETURNING)
  private async queryInsertedRows(count: number) {
    const primaryKey = this.getPrimaryKeyColumn();

    if (!primaryKey || primaryKey.kind === "boolean") {
      return [] as InferTableType<T>[];
    }

    let startId: number;
    let endId: number;

    if (this.isActualMysql()) {
      const [{ insertId }] = await this
        .sql`SELECT LAST_INSERT_ID() as insertId`;
      startId = Number(insertId) - count + 1;
      endId = Number(insertId);
    } else {
      const [{ lastId }] = await this.sql`SELECT last_insert_rowid() as lastId`;
      startId = Number(lastId) - count + 1;
      endId = Number(lastId);
    }

    if (startId <= 0) {
      return [] as InferTableType<T>[];
    }

    return this.sql<InferTableType<T>[]>`
      SELECT * FROM ${this.sql(this.table.sqlName)}
      WHERE ${this.sql(primaryKey.sqlName)} BETWEEN ${startId} AND ${endId}
    `;
  }

  // Read the just-inserted row by last insert ID, falling back to unique column lookup.
  // MySQL workaround since INSERT doesn't support RETURNING.
  private async readLastInsertedRows(
    data: CreateInput<T>,
    _count: number,
  ): Promise<InferTableType<T>[]> {
    const primaryKey = this.getPrimaryKeyColumn();

    if (primaryKey && primaryKey.kind !== "boolean") {
      const idFn = this.isActualMysql()
        ? this.sql`SELECT LAST_INSERT_ID() as id`
        : this.sql`SELECT last_insert_rowid() as id`;

      const [idError, idRows] = await mightThrow(idFn);
      if (!idError && idRows?.[0]) {
        const lastId = Number(idRows[0].id);
        const [readError, readResults] = await mightThrow(
          this.sql<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${this.sql(primaryKey.sqlName)} = ${lastId}
            LIMIT 1
          `,
        );
        if (!readError && readResults?.length) {
          return readResults;
        }
      }
    }

    // Fallback: search by a unique/pk column present in the input data
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

      if (!readError && readResults?.length) {
        return readResults;
      }
    }

    return [];
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

  private async readRowByPk(pkSqlName: string, pkValue: unknown) {
    return mightThrow(
      this.sql<InferTableType<T>[]>`
        SELECT * FROM ${this.sql(this.table.sqlName)}
        WHERE ${this.sql(pkSqlName)} = ${pkValue}
        LIMIT 1
      `,
    );
  }

  private async readRowBySelector(
    selectorSqlName: string,
    selectorValue: unknown,
  ) {
    return mightThrow(
      this.sql<InferTableType<T>[]>`
        SELECT * FROM ${this.sql(this.table.sqlName)}
        WHERE ${this.sql(selectorSqlName)} = ${selectorValue}
        LIMIT 1
      `,
    );
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

      sqlData[column.sqlName] = this.normalizeDateForStorage(column, value);
    }

    let results: InferTableType<T>[] = [];

    if (this.dialect.name !== "mysql") {
      // RETURNING path (SQLite, Postgres)
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
          `Failed to update row: ${toErrorMessage(updateError)}`,
        );
      }
      results = updateResults;
    } else if (this.isActualMysql()) {
      // Real MySQL: SELECT FOR UPDATE + UPDATE + re-read by PK
      const [txError, txResult] = await mightThrow(
        this.sql.begin(async (tx) => {
          const existingRows = await tx<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
            FOR UPDATE
          `;

          const [existing] = existingRows;
          if (!existing) {
            return [] as InferTableType<T>[];
          }

          await tx`
            UPDATE ${this.sql(this.table.sqlName)}
            SET ${this.sql(sqlData)}
            WHERE ${whereClause}
          `;

          const primaryKey = this.getPrimaryKeyColumn();
          if (primaryKey && primaryKey.kind !== "boolean") {
            const pkValue = existing[primaryKey.sqlName];
            return tx<InferTableType<T>[]>`
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

          return tx<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${this.sql(selectorColumn.sqlName)} = ${updatedSelectorValue}
            LIMIT 1
          `;
        }),
      );
      if (txError || !txResult) {
        return err(
          "InternalServerError",
          `Failed to update row: ${toErrorMessage(txError)}`,
        );
      }
      results = txResult;
    } else {
      // MySQL dialect with SQLite connection (test environment)
      // SELECT then UPDATE then re-read
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
          `Failed to load row for update: ${toErrorMessage(existingError)}`,
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
          `Failed to update row: ${toErrorMessage(writeError)}`,
        );
      }

      const primaryKey = this.getPrimaryKeyColumn();
      if (primaryKey && primaryKey.kind !== "boolean") {
        const pkValue = existing[primaryKey.sqlName];
        const [readError, readResults] = await this.readRowByPk(
          primaryKey.sqlName,
          pkValue,
        );
        if (readError || !readResults) {
          return err(
            "InternalServerError",
            `Failed to load updated row: ${toErrorMessage(readError)}`,
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

        const [readError, readResults] = await this.readRowBySelector(
          selectorColumn.sqlName,
          updatedSelectorValue,
        );
        if (readError || !readResults) {
          return err(
            "InternalServerError",
            `Failed to load updated row: ${toErrorMessage(readError)}`,
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

    let results: InferTableType<T>[] = [];

    if (this.dialect.name !== "mysql") {
      // RETURNING path (SQLite, Postgres)
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
          `Failed to delete row: ${toErrorMessage(deleteError)}`,
        );
      }
      results = deletedRows;
    } else if (this.isActualMysql()) {
      // Real MySQL: SELECT FOR UPDATE + DELETE (no RETURNING)
      const [txError, txResult] = await mightThrow(
        this.sql.begin(async (tx) => {
          const existingRows = await tx<InferTableType<T>[]>`
            SELECT * FROM ${this.sql(this.table.sqlName)}
            WHERE ${whereClause}
            FOR UPDATE
          `;

          if (existingRows.length === 0) {
            return [] as InferTableType<T>[];
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
          `Failed to delete row: ${toErrorMessage(txError)}`,
        );
      }
      results = txResult;
    } else {
      // MySQL dialect with SQLite connection (test environment)
      // SELECT then DELETE
      const [existingError, existingRows] = await mightThrow(
        this.sql<InferTableType<T>[]>`
          SELECT * FROM ${this.sql(this.table.sqlName)}
          WHERE ${whereClause}
        `,
      );
      if (existingError || !existingRows) {
        return err(
          "InternalServerError",
          `Failed to load row for delete: ${toErrorMessage(existingError)}`,
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
          `Failed to delete row: ${toErrorMessage(deleteError)}`,
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
