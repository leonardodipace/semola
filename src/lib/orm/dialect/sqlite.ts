import type {
  FindManyOptions,
  FindUniqueOptions,
  TableInclude,
  TableOrderBy,
  TableRelations,
  TableSelect,
  TableWhere,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import type { Dialect } from "./types.js";

type WhereClause = {
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

type PaginationClause = {
  sql: string;
  params: unknown[];
};

const serializeParam = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();

  return value;
};

const OPERATORS = {
  eq: {
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
    sql: "LIKE ?",
    transform: (v: unknown) => `${serializeParam(v)}%`,
  },
  endsWith: {
    sql: "LIKE ?",
    transform: (v: unknown) => `%${serializeParam(v)}`,
  },
  contains: {
    sql: "LIKE ?",
    transform: (v: unknown) => `%${serializeParam(v)}%`,
  },
} as const;

const buildWhereClause = <T extends Table>(
  table: T,
  where?: TableWhere<T>,
): WhereClause => {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!where) return { sql: "", params };

  const entries = Object.entries(where);

  for (const entry of entries) {
    const [jsKey, value] = entry;

    const typedKey = jsKey as keyof T["columns"];

    const sqlName = table.columns[typedKey].sqlName;

    if (typeof value !== "object") {
      clauses.push(`${sqlName} = ?`);
      params.push(serializeParam(value));
      continue;
    }

    const entries = Object.entries(value);

    for (const entry of entries) {
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
  if (!select) {
    return Object.entries(table.columns)
      .map(([k, col]) => getColumnAlias(col.sqlName, k))
      .join(", ");
  }

  const keys = Object.keys(select);

  return keys
    .flatMap((k) => {
      const sqlName = table.columns[k]?.sqlName;

      if (!sqlName) return [];

      return [getColumnAlias(sqlName, k)];
    })
    .join(", ");
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

const resolveHasManyForeignKeyColumn = (
  sourceTable: Table,
  targetTable: Table,
) => {
  const sourcePrimaryKey = getPrimaryKeyColumn(sourceTable);

  const entries = Object.entries(targetTable.columns);
  const candidates = entries.filter(([, column]) => {
    if (!column.references) return false;

    const getReferencedColumn = column.references.tableColumn;

    if (!getReferencedColumn) return false;

    const referencedColumn = getReferencedColumn();

    return referencedColumn === sourcePrimaryKey;
  });

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

  return candidate[1];
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
  if (!include) {
    return {
      sql: "",
      params: [],
      descriptors: [],
    } satisfies IncludeClause;
  }

  const enabledRelations = Object.entries(include).filter(([, enabled]) => {
    return enabled === true;
  });

  if (!enabledRelations.length) {
    return {
      sql: "",
      params: [],
      descriptors: [],
    } satisfies IncludeClause;
  }

  const sourcePrimaryKey = getPrimaryKeyColumn(table);
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
      const foreignKey = resolveHasManyForeignKeyColumn(table, relationTable);
      clauses.push(
        `COALESCE((SELECT json_group_array(${relationJsonObject}) FROM ${relationTable.sqlName} AS ${relationAlias} WHERE ${relationAlias}.${foreignKey.sqlName} = ${table.sqlName}.${sourcePrimaryKey.sqlName}), '[]') AS ${relationName}`,
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

const buildPaginationClause = (
  take?: number,
  skip?: number,
): PaginationClause => {
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
    throw new Error("findUnique requires exactly one where key");
  }

  if (keys.length > 1) {
    throw new Error("findUnique requires exactly one where key");
  }

  const key = keys[0];

  if (!key) {
    throw new Error("findUnique requires exactly one where key");
  }

  const columnEntry = Object.entries(table.columns).find(([columnName]) => {
    return columnName === key;
  });

  if (!columnEntry) {
    throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
  }

  const column = columnEntry[1];

  if (!column._meta.isPrimaryKey) {
    if (!column._meta.isUnique) {
      throw new Error(
        `findUnique where key ${key} must reference a unique or primary key column`,
      );
    }
  }
};

type FindManyQuery = {
  statement: string;
  params: unknown[];
  includeDescriptors: IncludeDescriptor[];
};

type FindUniqueQuery = {
  statement: string;
  params: unknown[];
  includeDescriptors: IncludeDescriptor[];
};

export const buildFindManyQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options?: FindManyOptions<T, R>,
): FindManyQuery => {
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

export const buildFindUniqueQuery = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
  options: FindUniqueOptions<T, R>,
): FindUniqueQuery => {
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

export const createSqliteDialect = <T extends Table, R extends TableRelations>(
  table: T,
  relations: R,
): Dialect<T, R> => {
  return {
    name: "sqlite",
    findMany: async (sql, options) => {
      const query = buildFindManyQuery(table, relations, options);
      const rows = [...(await sql.unsafe(query.statement, query.params))];

      if (!query.includeDescriptors.length) {
        return rows;
      }

      return parseIncludeRows(rows, query.includeDescriptors);
    },
    findUnique: async (sql, options) => {
      const query = buildFindUniqueQuery(table, relations, options);
      const rows = [...(await sql.unsafe(query.statement, query.params))];

      if (!query.includeDescriptors.length) {
        const firstRow = rows[0];

        if (!firstRow) return null;

        return firstRow;
      }

      const parsedRows = parseIncludeRows(rows, query.includeDescriptors);
      const firstRow = parsedRows[0];

      if (!firstRow) return null;

      return firstRow;
    },
  };
};
