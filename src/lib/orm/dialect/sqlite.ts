import type { Column } from "../column/types.js";
import type {
  CreateManyOptions,
  CreateOptions,
  DeleteManyOptions,
  DeleteOptions,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  TableInclude,
  TableOrderBy,
  TableRelations,
  TableSelect,
  TableWhere,
  UpdateManyOptions,
  UpdateOptions,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import type { Dialect } from "./types.js";

type SqlFragment = {
  sql: string;
  params: unknown[];
};

export type IncludeDescriptor = {
  name: string;
  type: "hasMany" | "hasOne";
};

type IncludeClause = {
  sql: string;
  params: unknown[];
  descriptors: IncludeDescriptor[];
};

const EMPTY_INCLUDE: IncludeClause = {
  sql: "",
  params: [],
  descriptors: [],
};

const serializeParam = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();

  return value;
};

const escapeLikeValue = (value: unknown) => {
  const escaped = `${serializeParam(value)}`
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");

  return serializeParam(escaped);
};

const OPERATORS = {
  equals: {
    sql: "= ?",
    transform: (v: unknown) => serializeParam(v),
  },
  gt: {
    sql: "> ?",
    transform: (v: unknown) => serializeParam(v),
  },
  gte: {
    sql: ">= ?",
    transform: (v: unknown) => serializeParam(v),
  },
  lt: {
    sql: "< ?",
    transform: (v: unknown) => serializeParam(v),
  },
  lte: {
    sql: "<= ?",
    transform: (v: unknown) => serializeParam(v),
  },
  startsWith: {
    sql: "LIKE ? ESCAPE '\\'",
    transform: (v: unknown) => serializeParam(`${escapeLikeValue(v)}%`),
  },
  endsWith: {
    sql: "LIKE ? ESCAPE '\\'",
    transform: (v: unknown) => serializeParam(`%${escapeLikeValue(v)}`),
  },
  contains: {
    sql: "LIKE ? ESCAPE '\\'",
    transform: (v: unknown) => serializeParam(`%${escapeLikeValue(v)}%`),
  },
} as const;

const isPlainObject = (value: unknown) => {
  if (value === null) return false;

  if (typeof value !== "object") return false;

  if (Array.isArray(value)) return false;

  if (value instanceof Date) return false;

  const prototype = Object.getPrototypeOf(value);

  if (prototype === null) return true;

  if (prototype === Object.prototype) return true;

  return false;
};

const buildWhereClause = <T extends Table>(
  table: T,
  where?: TableWhere<T>,
): SqlFragment => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!where) return { sql: "", params };

  const whereEntries = Object.entries(where);

  for (const entry of whereEntries) {
    const [jsKey, value] = entry;

    const typedKey = jsKey as keyof T["columns"];

    if (!(jsKey in table.columns)) {
      throw new Error(`Unknown where key "${jsKey}" on table ${table.sqlName}`);
    }

    const sqlName = table.columns[typedKey].sqlName;

    if (!isPlainObject(value)) {
      clauses.push(`${sqlName} = ?`);
      params.push(serializeParam(value));
      continue;
    }

    const operatorEntries = Object.entries(value);

    for (const entry of operatorEntries) {
      const [op, operand] = entry;
      const operator = OPERATORS[op as keyof typeof OPERATORS];

      if (!operator) continue;

      clauses.push(`${sqlName} ${operator.sql}`);
      params.push(operator.transform(operand));
    }
  }

  return { sql: clauses.join(" AND "), params };
};

const getColumnAlias = (sqlName: string, jsKey: string) => {
  return `${sqlName} AS ${jsKey}`;
};

const buildSelectColumns = <T extends Table>(
  table: T,
  select?: TableSelect<T>,
) => {
  if (!select || Object.keys(select).length === 0) {
    return Object.entries(table.columns)
      .map(([k, col]) => getColumnAlias(col.sqlName, k))
      .join(", ");
  }

  const selectedColumns: string[] = [];
  const keys = Object.keys(select);

  for (const key of keys) {
    const sqlName = table.columns[key]?.sqlName;

    if (!sqlName) continue;

    selectedColumns.push(getColumnAlias(sqlName, key));
  }

  return selectedColumns.join(", ");
};

const buildOrderByClause = <T extends Table>(
  table: T,
  orderBy?: TableOrderBy<T>,
) => {
  if (!orderBy) return "";

  const clauses: string[] = [];

  for (const [jsKey, direction] of Object.entries(orderBy)) {
    const sqlName = table.columns[jsKey as keyof T["columns"]]?.sqlName;

    if (!sqlName) continue;

    if (direction === "desc") {
      clauses.push(`${sqlName} DESC`);
      continue;
    }

    clauses.push(`${sqlName} ASC`);
  }

  if (!clauses.length) return "";

  return clauses.join(", ");
};

const getPrimaryKeyColumn = (table: Table) => {
  const entries = Object.entries(table.columns);
  const primaryKey = entries.find(([, column]) => column._meta.isPrimaryKey);

  if (!primaryKey) {
    throw new Error(`Missing primary key on table ${table.sqlName}`);
  }

  return primaryKey[1];
};

type HasManyCandidate = {
  fk: Column;
  source: { sqlName: string };
};

const resolveHasManyForeignKeyColumn = (
  sourceTable: Table,
  targetTable: Table,
) => {
  const sourceColumnValues = Object.values(sourceTable.columns);

  const candidates: HasManyCandidate[] = [];

  for (const [, column] of Object.entries(targetTable.columns)) {
    if (!column.references) continue;

    const getReferencedColumn = column.references.tableColumn;

    if (!getReferencedColumn) continue;

    const referencedColumn = getReferencedColumn();

    const referencesSourceColumn = sourceColumnValues.some(
      (sourceCol) => sourceCol === referencedColumn,
    );

    if (referencesSourceColumn) {
      candidates.push({ fk: column, source: referencedColumn });
    }
  }

  if (!candidates.length) {
    throw new Error(
      `Missing hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
    );
  }

  const candidate = candidates[0];

  if (!candidate) {
    throw new Error(
      `Missing hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
    );
  }

  return candidate;
};

const buildJsonObjectExpression = (alias: string, table: Table) => {
  const columns = Object.entries(table.columns);

  const pairs = columns
    .flatMap(([jsKey, column]) => {
      return [`'${jsKey}'`, `${alias}.${column.sqlName}`];
    })
    .join(", ");

  return `json_object(${pairs})`;
};

const buildIncludeClause = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  include?: TableInclude<R>,
) => {
  if (!include) return EMPTY_INCLUDE;

  const enabledRelations = Object.entries(include).filter(([, enabled]) => {
    return enabled === true;
  });

  if (!enabledRelations.length) return EMPTY_INCLUDE;

  const clauses: string[] = [];
  const descriptors: IncludeDescriptor[] = [];

  for (const [relationName] of enabledRelations) {
    const relation = relations[relationName as keyof R];

    if (!relation) {
      throw new Error(
        `Unknown relation ${relationName} on table ${table.sqlName}`,
      );
    }

    const relationTable = relation._table;
    const relationAlias = `${relationName}__${relationTable.sqlName}`;
    const relationJsonObject = buildJsonObjectExpression(
      relationAlias,
      relationTable,
    );

    if (relation._type === "hasMany") {
      const { fk: foreignKey, source: sourceColumn } =
        resolveHasManyForeignKeyColumn(table, relationTable);
      clauses.push(
        `COALESCE((SELECT json_group_array(${relationJsonObject}) FROM ${relationTable.sqlName} AS ${relationAlias} WHERE ${relationAlias}.${foreignKey.sqlName} = ${table.sqlName}.${sourceColumn.sqlName}), '[]') AS ${relationName}`,
      );
      descriptors.push({ name: relationName, type: "hasMany" });
      continue;
    }

    const localForeignKeyName = `${relationName}Id`;
    const localForeignKeyEntry = Object.entries(table.columns).find(
      ([columnName]) => columnName === localForeignKeyName,
    );
    const localForeignKey = localForeignKeyEntry?.[1];

    if (!localForeignKey) {
      throw new Error(
        `Missing hasOne foreign key column ${localForeignKeyName} on ${table.sqlName}`,
      );
    }

    const relationPrimaryKey = getPrimaryKeyColumn(relationTable);
    clauses.push(
      `(SELECT ${relationJsonObject} FROM ${relationTable.sqlName} AS ${relationAlias} WHERE ${relationAlias}.${relationPrimaryKey.sqlName} = ${table.sqlName}.${localForeignKey.sqlName} LIMIT 1) AS ${relationName}`,
    );
    descriptors.push({ name: relationName, type: "hasOne" });
  }

  return {
    sql: clauses.join(", "),
    params: [],
    descriptors,
  } satisfies IncludeClause;
};

const buildPaginationClause = (take?: number, skip?: number): SqlFragment => {
  const params: unknown[] = [];

  if (take === undefined) {
    if (skip === undefined) {
      return {
        sql: "",
        params,
      };
    }

    params.push(skip);

    return {
      sql: "LIMIT -1 OFFSET ?",
      params,
    };
  }

  params.push(take);

  if (skip === undefined) {
    return {
      sql: "LIMIT ?",
      params,
    };
  }

  params.push(skip);

  return {
    sql: "LIMIT ? OFFSET ?",
    params,
  };
};

const buildSelectStatement = (
  tableName: string,
  columns: string,
  where: string,
  orderBy: string,
  pagination: string,
) => {
  let query = `SELECT ${columns} FROM ${tableName}`;

  if (where) query = `${query} WHERE ${where}`;

  if (orderBy) query = `${query} ORDER BY ${orderBy}`;

  if (pagination) query = `${query} ${pagination}`;

  return query;
};

const validateFindUniqueWhere = (
  table: Table,
  where: Record<string, unknown>,
) => {
  const keys = Object.keys(where);

  if (!keys.length) {
    throw new Error("findUnique requires at least one where key");
  }

  let hasUniqueKey = false;

  for (const key of keys) {
    const columnEntry = Object.entries(table.columns).find(([columnName]) => {
      return columnName === key;
    });

    if (!columnEntry) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

    const column = columnEntry[1];

    if (column._meta.isPrimaryKey || column._meta.isUnique) {
      hasUniqueKey = true;
    }
  }

  if (!hasUniqueKey) {
    throw new Error(
      "findUnique where must include at least one unique or primary key column",
    );
  }
};

type ReturningQuery = {
  statement: string;
  params: unknown[];
  includeDescriptors: IncludeDescriptor[];
};

const resolveCreateValue = (column: Column, provided: unknown) => {
  if (provided !== undefined) return provided;

  if (column._default) return column._default();

  return null;
};

export const buildCreateQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options: CreateOptions<T, R>,
): ReturningQuery => {
  const provided = new Map<string, unknown>(Object.entries(options.data));
  const sqlNames: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, column] of Object.entries(table.columns)) {
    const value = resolveCreateValue(column, provided.get(jsKey));

    sqlNames.push(column.sqlName);
    placeholders.push("?");
    params.push(serializeParam(value));
  }

  const columns = buildSelectColumns(table, options.select);
  const include = buildIncludeClause(table, relations, options.include);
  const returning = include.sql ? `${columns}, ${include.sql}` : columns;
  const statement = `INSERT INTO ${table.sqlName} (${sqlNames.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING ${returning}`;

  return { statement, params, includeDescriptors: include.descriptors };
};

export const buildUpdateQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options: UpdateOptions<T, R>,
): ReturningQuery => {
  validateFindUniqueWhere(table, options.where);

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, value] of Object.entries(options.data)) {
    const column = table.columns[jsKey];

    if (!column) continue;

    setClauses.push(`${column.sqlName} = ?`);
    params.push(serializeParam(value));
  }

  if (!setClauses.length) {
    throw new Error("update requires at least one field in data");
  }

  const where = buildWhereClause(table, options.where);
  const columns = buildSelectColumns(table, options.select);
  const include = buildIncludeClause(table, relations, options.include);
  const returning = include.sql ? `${columns}, ${include.sql}` : columns;

  let statement = `UPDATE ${table.sqlName} SET ${setClauses.join(", ")}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  statement = `${statement} RETURNING ${returning}`;

  params.push(...where.params);

  return { statement, params, includeDescriptors: include.descriptors };
};

export const buildFindManyQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options?: FindManyOptions<T, R>,
): ReturningQuery => {
  const where = buildWhereClause(table, options?.where);
  const columns = buildSelectColumns(table, options?.select);
  const orderBy = buildOrderByClause(table, options?.orderBy);
  const include = buildIncludeClause(table, relations, options?.include);
  const pagination = buildPaginationClause(options?.take, options?.skip);
  const selectColumns = include.sql ? `${columns}, ${include.sql}` : columns;
  const params = [...where.params, ...include.params, ...pagination.params];
  const statement = buildSelectStatement(
    table.sqlName,
    selectColumns,
    where.sql,
    orderBy,
    pagination.sql,
  );

  return {
    statement,
    params,
    includeDescriptors: include.descriptors,
  };
};

export const buildDeleteQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options: DeleteOptions<T, R>,
): ReturningQuery => {
  validateFindUniqueWhere(table, options.where);

  const where = buildWhereClause(table, options.where);
  const columns = buildSelectColumns(table, options.select);
  const include = buildIncludeClause(table, relations, options.include);
  const returning = include.sql ? `${columns}, ${include.sql}` : columns;

  let statement = `DELETE FROM ${table.sqlName}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  statement = `${statement} RETURNING ${returning}`;

  const params = [...where.params, ...include.params];

  return { statement, params, includeDescriptors: include.descriptors };
};

export const buildFindFirstQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options?: FindFirstOptions<T, R>,
): ReturningQuery => {
  return buildFindManyQuery(table, relations, { ...options, take: 1 });
};

export const buildFindUniqueQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options: FindUniqueOptions<T, R>,
): ReturningQuery => {
  validateFindUniqueWhere(table, options.where);

  const where = buildWhereClause(table, options.where);
  const columns = buildSelectColumns(table, options.select);
  const include = buildIncludeClause(table, relations, options.include);
  const selectColumns = include.sql ? `${columns}, ${include.sql}` : columns;
  const params = [...where.params, ...include.params];
  const statement = buildSelectStatement(
    table.sqlName,
    selectColumns,
    where.sql,
    "",
    "LIMIT 1",
  );

  return {
    statement,
    params,
    includeDescriptors: include.descriptors,
  };
};

export const parseIncludeRows = (
  rows: Array<Record<string, unknown>>,
  descriptors: IncludeDescriptor[],
) => {
  return rows.map((row) => {
    const result = { ...row };

    for (const descriptor of descriptors) {
      const value = row[descriptor.name];

      if (value === null) {
        if (descriptor.type === "hasMany") {
          result[descriptor.name] = [];
        }

        continue;
      }

      if (typeof value !== "string") continue;

      result[descriptor.name] = JSON.parse(value);
    }

    return result;
  });
};

const executeQuery = async (sql: Bun.SQL, query: ReturningQuery) => {
  const rows = [...(await sql.unsafe(query.statement, query.params))];

  if (!query.includeDescriptors.length) {
    return rows;
  }

  return parseIncludeRows(rows, query.includeDescriptors);
};

const getFirstRow = <TRow>(rows: Array<TRow>) => {
  const firstRow = rows[0];

  if (!firstRow) {
    return null;
  }

  return firstRow;
};

export const buildCreateManyQuery = <T extends Table>(
  table: T,
  options: CreateManyOptions<T>,
) => {
  if (!options.data.length) {
    return { statement: "", params: [] };
  }

  const columnEntries = Object.entries(table.columns);
  const sqlNames = columnEntries.map(([, col]) => col.sqlName);
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (const row of options.data) {
    const provided = new Map<string, unknown>(Object.entries(row));
    const placeholders: string[] = [];

    for (const [jsKey, column] of columnEntries) {
      const value = resolveCreateValue(column, provided.get(jsKey));
      placeholders.push("?");
      params.push(serializeParam(value));
    }

    rowPlaceholders.push(`(${placeholders.join(", ")})`);
  }

  const statement = `INSERT INTO ${table.sqlName} (${sqlNames.join(", ")}) VALUES ${rowPlaceholders.join(", ")}`;

  return { statement, params };
};

export const buildUpdateManyQuery = <T extends Table>(
  table: T,
  options: UpdateManyOptions<T>,
) => {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, value] of Object.entries(options.data)) {
    const column = table.columns[jsKey];

    if (!column) continue;

    setClauses.push(`${column.sqlName} = ?`);
    params.push(serializeParam(value));
  }

  if (!setClauses.length) {
    throw new Error("updateMany requires at least one field in data");
  }

  const where = buildWhereClause(table, options.where);

  let statement = `UPDATE ${table.sqlName} SET ${setClauses.join(", ")}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  params.push(...where.params);

  return { statement, params };
};

export const buildDeleteManyQuery = <T extends Table>(
  table: T,
  options: DeleteManyOptions<T>,
) => {
  const where = buildWhereClause(table, options.where);

  let statement = `DELETE FROM ${table.sqlName}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  return { statement, params: where.params };
};

export const createSqliteDialect = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
): Dialect<T, R> => {
  return {
    name: "sqlite",
    findMany: async (sql, options) => {
      const query = buildFindManyQuery(table, relations, options);

      return await executeQuery(sql, query);
    },
    // findFirst and findUnique build different queries but share row execution/parsing.
    findFirst: async (sql, options) => {
      const query = buildFindFirstQuery(table, relations, options);
      const rows = await executeQuery(sql, query);

      return getFirstRow(rows);
    },
    findUnique: async (sql, options) => {
      const query = buildFindUniqueQuery(table, relations, options);
      const rows = await executeQuery(sql, query);

      return getFirstRow(rows);
    },
    create: async (sql, options) => {
      const query = buildCreateQuery(table, relations, options);
      const rows = await executeQuery(sql, query);
      const row = getFirstRow(rows);

      if (!row) {
        throw new Error(
          `Record not found after insert on table ${table.sqlName}`,
        );
      }

      return row;
    },
    createMany: async (sql, options) => {
      if (!options.data.length) {
        return { count: 0 };
      }

      const query = buildCreateManyQuery(table, options);
      const result = await sql.unsafe(query.statement, query.params);

      return { count: result.count };
    },
    update: async (sql, options) => {
      const query = buildUpdateQuery(table, relations, options);
      const rows = await executeQuery(sql, query);
      const row = getFirstRow(rows);

      if (!row) {
        throw new Error(
          `Record not found after update on table ${table.sqlName}`,
        );
      }

      return row;
    },
    updateMany: async (sql, options) => {
      const query = buildUpdateManyQuery(table, options);
      const result = await sql.unsafe(query.statement, query.params);

      return { count: result.count };
    },
    delete: async (sql, options) => {
      const query = buildDeleteQuery(table, relations, options);
      const rows = await executeQuery(sql, query);
      const row = getFirstRow(rows);

      if (!row) {
        throw new Error(
          `Record not found after delete on table ${table.sqlName}`,
        );
      }

      return row;
    },
    deleteMany: async (sql, options) => {
      const query = buildDeleteManyQuery(table, options);
      const result = await sql.unsafe(query.statement, query.params);

      return { count: result.count };
    },
  };
};
