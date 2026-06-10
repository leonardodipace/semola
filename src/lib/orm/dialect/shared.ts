import type { Column } from "../column/types.js";
import type {
  TableOrderBy,
  TableRelations,
  TableSelect,
  TableWhere,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import type {
  BuildCreateManyQueryInput,
  BuildCreateQueryInput,
  BuildDeleteManyQueryInput,
  BuildDeleteQueryInput,
  BuildFindFirstQueryInput,
  BuildFindManyQueryInput,
  BuildFindUniqueQueryInput,
  BuildIncludeClauseInput,
  BuildJsonObjectExpressionInput,
  BuildPaginationClauseInput,
  BuildRelationSubqueryInput,
  BuildSelectIncludeWhereInput,
  BuildSelectStatementInput,
  BuildSetClausesInput,
  BuildUpdateManyQueryInput,
  BuildUpdateQueryInput,
  BuildWhereClauseInput,
  BuildWhereIncludeReturningInput,
  CoerceRelationItemsInput,
  CoerceRowInput,
  CreateDialectInput,
  Dialect,
  DialectSpec,
  ExecuteQueryInput,
  HasManyCandidate,
  HasOneCandidate,
  IncludeClause,
  IncludeDescriptor,
  ParseIncludeRowsInput,
  RelationQueryOptions,
  RelationSubqueryResult,
  ResolveHasOneForeignKeyColumnInput,
  ReturningQuery,
  SqlFragment,
} from "./types.js";

const createNextPlaceholder = (spec: DialectSpec) => {
  let index = 0;

  return () => {
    index += 1;

    return spec.formatPlaceholder(index);
  };
};

const EMPTY_INCLUDE: IncludeClause = {
  sql: "",
  params: [],
  descriptors: [],
};

const buildSelectList = (columns: string, include: IncludeClause) => {
  if (include.sql) return `${columns}, ${include.sql}`;

  return columns;
};

const serializeParam = (value: unknown) => {
  if (value instanceof Date) return value.toISOString();

  return value;
};

const serializeColumnValue = (column: Column, value: unknown) => {
  if (column.type !== "json" && column.type !== "jsonb")
    return serializeParam(value);
  if (value === null) return value;
  if (value === undefined) return null;

  return JSON.stringify(value);
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
    sql: (ph: string) => `= ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  gt: {
    sql: (ph: string) => `> ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  gte: {
    sql: (ph: string) => `>= ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  lt: {
    sql: (ph: string) => `< ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  lte: {
    sql: (ph: string) => `<= ${ph}`,
    transform: (v: unknown) => serializeParam(v),
  },
  startsWith: {
    sql: (ph: string) => `LIKE ${ph} ESCAPE '\\'`,
    transform: (v: unknown) => serializeParam(`${escapeLikeValue(v)}%`),
  },
  endsWith: {
    sql: (ph: string) => `LIKE ${ph} ESCAPE '\\'`,
    transform: (v: unknown) => serializeParam(`%${escapeLikeValue(v)}`),
  },
  contains: {
    sql: (ph: string) => `LIKE ${ph} ESCAPE '\\'`,
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

// fallow-ignore-next-line complexity
const buildWhereClause = <T extends Table>(
  input: BuildWhereClauseInput<T>,
): SqlFragment => {
  const { nextPlaceholder, table, where } = input;

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!where) return { sql: "", params };

  const whereEntries = Object.entries(where);

  for (const entry of whereEntries) {
    const [jsKey, value] = entry;

    if (value === undefined) continue;

    const typedKey = jsKey as keyof T["columns"];

    if (!(jsKey in table.columns)) {
      throw new Error(`Unknown where key "${jsKey}" on table ${table.sqlName}`);
    }

    const sqlName = quoteIdentifier(table.columns[typedKey].sqlName);

    if (!isPlainObject(value)) {
      if (value === null) {
        clauses.push(`${sqlName} IS NULL`);
      } else {
        clauses.push(`${sqlName} = ${nextPlaceholder()}`);
        params.push(serializeColumnValue(table.columns[typedKey], value));
      }
      continue;
    }

    const operatorEntries = Object.entries(value);

    for (const entry of operatorEntries) {
      const [op, operand] = entry;
      const operator = OPERATORS[op as keyof typeof OPERATORS];

      if (!operator) {
        throw new Error(`Unknown where operator: ${op} for field ${jsKey}`);
      }

      if (op === "equals" && operand === null) {
        clauses.push(`${sqlName} IS NULL`);
        continue;
      }

      clauses.push(`${sqlName} ${operator.sql(nextPlaceholder())}`);
      params.push(
        operator.transform(
          serializeColumnValue(table.columns[typedKey], operand),
        ),
      );
    }
  }

  return { sql: clauses.join(" AND "), params };
};

const getColumnAlias = (sqlName: string, jsKey: string) => {
  return `${quoteIdentifier(sqlName)} AS ${quoteIdentifier(jsKey)}`;
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
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown select key "${key}" on table ${table.sqlName}`);
    }

    selectedColumns.push(getColumnAlias(column.sqlName, key));
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
    const column = table.columns[jsKey];

    if (!column) {
      throw new Error(
        `Unknown orderBy key "${jsKey}" on table ${table.sqlName}`,
      );
    }

    if (direction === "desc") {
      clauses.push(`${quoteIdentifier(column.sqlName)} DESC`);
      continue;
    }

    clauses.push(`${quoteIdentifier(column.sqlName)} ASC`);
  }

  if (!clauses.length) return "";

  return clauses.join(", ");
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

  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
    );
  }

  const [candidate] = candidates;

  if (!candidate) {
    throw new Error(
      `Missing hasMany foreign key from ${targetTable.sqlName} to ${sourceTable.sqlName}`,
    );
  }

  return candidate;
};

const resolveHasOneForeignKeyColumn = (
  input: ResolveHasOneForeignKeyColumnInput,
): HasOneCandidate => {
  const { sourceTable, relationTable, relationForeignKey } = input;

  const localForeignKey = sourceTable.columns[relationForeignKey];

  if (!localForeignKey) {
    throw new Error(
      `Missing hasOne foreign key column ${relationForeignKey} on ${sourceTable.sqlName}`,
    );
  }

  if (!localForeignKey.references?.tableColumn) {
    throw new Error(
      `Column ${relationForeignKey} on ${sourceTable.sqlName} is not a foreign key - call .references() on it`,
    );
  }

  const referencedColumn = localForeignKey.references.tableColumn();
  const relationColumns = Object.values(relationTable.columns);

  const referencesRelationTable = relationColumns.some((column) => {
    return column === referencedColumn;
  });

  if (!referencesRelationTable) {
    throw new Error(
      `Column ${relationForeignKey} on ${sourceTable.sqlName} does not reference ${relationTable.sqlName}`,
    );
  }

  return {
    localForeignKey,
    target: referencedColumn,
  };
};

// Builds e.g. `json_object('id', alias."id", 'title', alias."title", ...extraPairs)`.
const buildJsonObjectExpression = (input: BuildJsonObjectExpressionInput) => {
  const { spec, alias, table, extraPairs = [], select } = input;

  const allEntries = Object.entries(table.columns);
  const hasSelect = select !== undefined && Object.keys(select).length > 0;

  let visibleEntries = allEntries;

  if (hasSelect) {
    visibleEntries = allEntries.filter(([key]) => key in select);
  }

  const pairs = visibleEntries.flatMap(([jsKey, column]) => [
    `'${jsKey}'`,
    `${alias}.${quoteIdentifier(column.sqlName)}`,
  ]);

  return `${spec.jsonObjectFunctionName}(${[...pairs, ...extraPairs].join(", ")})`;
};

// fallow-ignore-next-line complexity
const buildRelationSubquery = (
  input: BuildRelationSubqueryInput,
): RelationSubqueryResult => {
  const {
    spec,
    nextPlaceholder,
    parentTable,
    parentAlias,
    relation,
    relationName,
    includeValue,
    tableRelationsMap,
  } = input;

  let options: RelationQueryOptions = {};

  if (typeof includeValue === "object" && includeValue !== null) {
    options = includeValue as RelationQueryOptions;
  }

  const relationTable = relation._table;
  const relationAlias = `${relationName}__${relationTable.sqlName}`;
  const nestedRelations = tableRelationsMap.get(relationTable) ?? {};

  const nestedExtraPairs: string[] = [];
  const nestedParams: unknown[] = [];
  const nestedDescriptors: IncludeDescriptor[] = [];

  if (options.include) {
    for (const [nestedName, nestedValue] of Object.entries(options.include)) {
      if (!nestedValue) continue;

      const nestedRelation = nestedRelations[nestedName];

      if (!nestedRelation) continue;

      const result = buildRelationSubquery({
        spec,
        nextPlaceholder,
        parentTable: relationTable,
        parentAlias: relationAlias,
        relation: nestedRelation,
        relationName: nestedName,
        includeValue: nestedValue,
        tableRelationsMap,
      });

      nestedExtraPairs.push(`'${nestedName}'`, result.sql);
      nestedParams.push(...result.params);
      nestedDescriptors.push(result.descriptor);
    }
  }

  const jsonObj = buildJsonObjectExpression({
    spec,
    alias: relationAlias,
    table: relationTable,
    extraPairs: nestedExtraPairs,
    select: options.select,
  });

  // buildWhereClause/buildOrderByClause/buildPaginationClause all handle undefined, always call them
  const where = buildWhereClause({
    nextPlaceholder,
    table: relationTable,
    where: options.where as TableWhere<Table>,
  });

  const orderBy = buildOrderByClause(
    relationTable,
    options.orderBy as TableOrderBy<Table>,
  );

  const pagination = buildPaginationClause({
    spec,
    nextPlaceholder,
    take: options.take,
    skip: options.skip,
  });

  const allParams = [...nestedParams, ...where.params, ...pagination.params];

  if (relation._type === "hasMany") {
    const { fk: foreignKey, source: sourceColumn } =
      resolveHasManyForeignKeyColumn(parentTable, relationTable);

    const fkCondition = `${relationAlias}.${quoteIdentifier(foreignKey.sqlName)} = ${parentAlias}.${quoteIdentifier(sourceColumn.sqlName)}`;

    let whereSql = fkCondition;

    if (where.sql) {
      whereSql = `${fkCondition} AND ${where.sql}`;
    }

    let subquery: string;

    if (orderBy || pagination.sql) {
      // Nested form: ORDER BY / LIMIT must go on the inner query so they affect
      // the rows fed to the aggregate, not the (single) aggregate result row
      let innerQuery = `SELECT * FROM ${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias} WHERE ${whereSql}`;

      if (orderBy) innerQuery = `${innerQuery} ORDER BY ${orderBy}`;

      if (pagination.sql) innerQuery = `${innerQuery} ${pagination.sql}`;

      subquery = `SELECT ${spec.jsonArrayAggregateFunctionName}(${jsonObj}) FROM (${innerQuery}) AS ${relationAlias}`;
    } else {
      subquery = `SELECT ${spec.jsonArrayAggregateFunctionName}(${jsonObj}) FROM ${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias} WHERE ${whereSql}`;
    }

    return {
      sql: `COALESCE((${subquery}), ${spec.emptyJsonArrayLiteral})`,
      params: allParams,
      descriptor: {
        name: relationName,
        type: "hasMany",
        table: relationTable,
        nested: nestedDescriptors,
      },
    };
  }

  const { localForeignKey, target } = resolveHasOneForeignKeyColumn({
    sourceTable: parentTable,
    relationTable,
    relationForeignKey: relation._foreignKey,
  });

  const fkCondition = `${relationAlias}.${quoteIdentifier(target.sqlName)} = ${parentAlias}.${quoteIdentifier(localForeignKey.sqlName)}`;

  let whereSql = fkCondition;

  if (where.sql) {
    whereSql = `${fkCondition} AND ${where.sql}`;
  }

  const subquery = `SELECT ${jsonObj} FROM ${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias} WHERE ${whereSql} LIMIT 1`;

  return {
    sql: `(${subquery})`,
    params: allParams,
    descriptor: {
      name: relationName,
      type: "hasOne",
      table: relationTable,
      nested: nestedDescriptors,
    },
  };
};

const buildIncludeClause = <T extends Table, R extends TableRelations>(
  input: BuildIncludeClauseInput<T, R>,
) => {
  const {
    spec,
    nextPlaceholder,
    table,
    parentAlias,
    relations,
    tableRelationsMap,
    include,
  } = input;

  if (!include) return EMPTY_INCLUDE;

  const enabledRelations = Object.entries(include).filter(([, v]) =>
    Boolean(v),
  );

  if (!enabledRelations.length) return EMPTY_INCLUDE;

  const clauses: string[] = [];
  const params: unknown[] = [];
  const descriptors: IncludeDescriptor[] = [];

  for (const [relationName, includeValue] of enabledRelations) {
    const relation = relations[relationName as keyof R];

    if (!relation) {
      throw new Error(
        `Unknown relation ${relationName} on table ${table.sqlName}`,
      );
    }

    const result = buildRelationSubquery({
      spec,
      nextPlaceholder,
      parentTable: table,
      parentAlias,
      relation,
      relationName,
      includeValue,
      tableRelationsMap,
    });

    clauses.push(`${result.sql} AS ${quoteIdentifier(relationName)}`);
    params.push(...result.params);
    descriptors.push(result.descriptor);
  }

  return {
    sql: clauses.join(", "),
    params,
    descriptors,
  } satisfies IncludeClause;
};

const buildPaginationClause = (
  input: BuildPaginationClauseInput,
): SqlFragment => {
  const { spec, nextPlaceholder, take, skip } = input;

  const params: unknown[] = [];

  if (take === undefined) {
    if (skip === undefined) {
      return {
        sql: "",
        params,
      };
    }

    const skipPh = nextPlaceholder();
    params.push(skip);

    return {
      sql: `${spec.unlimitedOffsetKeyword} ${skipPh}`,
      params,
    };
  }

  const takePh = nextPlaceholder();
  params.push(take);

  if (skip === undefined) {
    return {
      sql: `LIMIT ${takePh}`,
      params,
    };
  }

  const skipPh = nextPlaceholder();
  params.push(skip);

  return {
    sql: `LIMIT ${takePh} OFFSET ${skipPh}`,
    params,
  };
};

const buildSelectStatement = (input: BuildSelectStatementInput) => {
  const { tableName, columns, where, orderBy, pagination } = input;

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
    const column = table.columns[key];

    if (!column) {
      throw new Error(`Unknown where key ${key} on table ${table.sqlName}`);
    }

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

const resolveCreateValue = (column: Column, provided: unknown) => {
  if (provided !== undefined) return provided;

  if (column._default) return column._default();

  return null;
};

const buildSetClauses = <T extends Table>(input: BuildSetClausesInput<T>) => {
  const { nextPlaceholder, table, data } = input;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, value] of Object.entries(data)) {
    if (value === undefined) continue;

    const column = table.columns[jsKey];

    if (!column) continue;

    setClauses.push(
      `${quoteIdentifier(column.sqlName)} = ${nextPlaceholder()}`,
    );
    params.push(serializeColumnValue(column, value));
  }

  return { setClauses, params };
};

const buildWhereIncludeReturning = <T extends Table, R extends TableRelations>(
  input: BuildWhereIncludeReturningInput<T, R>,
) => {
  const { spec, nextPlaceholder, table, relations, tableRelationsMap } = input;
  const { where: whereInput, select, include: includeInput } = input;

  const where = buildWhereClause({ nextPlaceholder, table, where: whereInput });
  const columns = buildSelectColumns(table, select);
  // Include is in RETURNING (after WHERE), so call after where is assigned
  const include = buildIncludeClause({
    spec,
    nextPlaceholder,
    table,
    parentAlias: quoteIdentifier(table.sqlName),
    relations,
    tableRelationsMap,
    include: includeInput,
  });
  const returning = buildSelectList(columns, include);

  return { where, include, returning };
};

const buildSelectIncludeWhere = <T extends Table, R extends TableRelations>(
  input: BuildSelectIncludeWhereInput<T, R>,
) => {
  const { spec, nextPlaceholder, table, relations, tableRelationsMap } = input;
  const { where: whereInput, select, include: includeInput } = input;

  // Include must consume placeholders before where - it appears in SELECT
  const include = buildIncludeClause({
    spec,
    nextPlaceholder,
    table,
    parentAlias: quoteIdentifier(table.sqlName),
    relations,
    tableRelationsMap,
    include: includeInput,
  });
  const where = buildWhereClause({ nextPlaceholder, table, where: whereInput });
  const columns = buildSelectColumns(table, select);
  const selectColumns = buildSelectList(columns, include);

  return { include, where, selectColumns };
};

export const buildCreateQuery = <T extends Table, R extends TableRelations>(
  input: BuildCreateQueryInput<T, R>,
): ReturningQuery => {
  const {
    spec,
    table,
    relations,
    options,
    tableRelationsMap = new Map(),
  } = input;

  const nextPlaceholder = createNextPlaceholder(spec);
  const provided = new Map<string, unknown>(Object.entries(options.data));
  const sqlNames: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];

  for (const [jsKey, column] of Object.entries(table.columns)) {
    const value = resolveCreateValue(column, provided.get(jsKey));

    sqlNames.push(quoteIdentifier(column.sqlName));
    placeholders.push(nextPlaceholder());
    params.push(serializeColumnValue(column, value));
  }

  const columns = buildSelectColumns(table, options.select);
  // Include is in RETURNING (after VALUES), so call after values are assigned
  const include = buildIncludeClause({
    spec,
    nextPlaceholder,
    table,
    parentAlias: quoteIdentifier(table.sqlName),
    relations,
    tableRelationsMap,
    include: options.include,
  });
  const returning = buildSelectList(columns, include);
  const statement = `INSERT INTO ${quoteIdentifier(table.sqlName)} (${sqlNames.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING ${returning}`;

  return {
    statement,
    params: [...params, ...include.params],
    includeDescriptors: include.descriptors,
  };
};

export const buildUpdateQuery = <T extends Table, R extends TableRelations>(
  input: BuildUpdateQueryInput<T, R>,
): ReturningQuery => {
  const {
    spec,
    table,
    relations,
    options,
    tableRelationsMap = new Map(),
  } = input;

  validateFindUniqueWhere(table, options.where);

  const nextPlaceholder = createNextPlaceholder(spec);
  const { setClauses, params } = buildSetClauses({
    nextPlaceholder,
    table,
    data: options.data,
  });

  if (!setClauses.length) {
    throw new Error("update requires at least one field in data");
  }

  const { where, include, returning } = buildWhereIncludeReturning({
    spec,
    nextPlaceholder,
    table,
    relations,
    tableRelationsMap,
    where: options.where,
    select: options.select,
    include: options.include,
  });

  let statement = `UPDATE ${quoteIdentifier(table.sqlName)} SET ${setClauses.join(", ")}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  statement = `${statement} RETURNING ${returning}`;

  params.push(...where.params, ...include.params);

  return {
    statement,
    params,
    includeDescriptors: include.descriptors,
  };
};

export const buildFindManyQuery = <T extends Table, R extends TableRelations>(
  input: BuildFindManyQueryInput<T, R>,
): ReturningQuery => {
  const {
    spec,
    table,
    relations,
    options,
    tableRelationsMap = new Map(),
  } = input;

  const nextPlaceholder = createNextPlaceholder(spec);
  const { include, where, selectColumns } = buildSelectIncludeWhere({
    spec,
    nextPlaceholder,
    table,
    relations,
    tableRelationsMap,
    where: options?.where,
    select: options?.select,
    include: options?.include,
  });
  const orderBy = buildOrderByClause(table, options?.orderBy);
  const pagination = buildPaginationClause({
    spec,
    nextPlaceholder,
    take: options?.take,
    skip: options?.skip,
  });
  const params = [...include.params, ...where.params, ...pagination.params];
  const statement = buildSelectStatement({
    tableName: quoteIdentifier(table.sqlName),
    columns: selectColumns,
    where: where.sql,
    orderBy,
    pagination: pagination.sql,
  });

  return {
    statement,
    params,
    includeDescriptors: include.descriptors,
  };
};

export const buildDeleteQuery = <T extends Table, R extends TableRelations>(
  input: BuildDeleteQueryInput<T, R>,
): ReturningQuery => {
  const {
    spec,
    table,
    relations,
    options,
    tableRelationsMap = new Map(),
  } = input;

  validateFindUniqueWhere(table, options.where);

  const nextPlaceholder = createNextPlaceholder(spec);
  const { where, include, returning } = buildWhereIncludeReturning({
    spec,
    nextPlaceholder,
    table,
    relations,
    tableRelationsMap,
    where: options.where,
    select: options.select,
    include: options.include,
  });

  let statement = `DELETE FROM ${quoteIdentifier(table.sqlName)}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  statement = `${statement} RETURNING ${returning}`;

  return {
    statement,
    params: [...where.params, ...include.params],
    includeDescriptors: include.descriptors,
  };
};

export const buildFindFirstQuery = <T extends Table, R extends TableRelations>(
  input: BuildFindFirstQueryInput<T, R>,
): ReturningQuery => {
  const {
    spec,
    table,
    relations,
    options,
    tableRelationsMap = new Map(),
  } = input;

  return buildFindManyQuery({
    spec,
    table,
    relations,
    options: { ...options, take: 1 },
    tableRelationsMap,
  });
};

export const buildFindUniqueQuery = <T extends Table, R extends TableRelations>(
  input: BuildFindUniqueQueryInput<T, R>,
): ReturningQuery => {
  const {
    spec,
    table,
    relations,
    options,
    tableRelationsMap = new Map(),
  } = input;

  validateFindUniqueWhere(table, options.where);

  const nextPlaceholder = createNextPlaceholder(spec);
  const { include, where, selectColumns } = buildSelectIncludeWhere({
    spec,
    nextPlaceholder,
    table,
    relations,
    tableRelationsMap,
    where: options.where,
    select: options.select,
    include: options.include,
  });
  const statement = buildSelectStatement({
    tableName: quoteIdentifier(table.sqlName),
    columns: selectColumns,
    where: where.sql,
    orderBy: "",
    pagination: "LIMIT 1",
  });

  return {
    statement,
    params: [...include.params, ...where.params],
    includeDescriptors: include.descriptors,
  };
};

const coerceBooleanValue = (val: unknown) => {
  if (val === null) return val;
  if (val === undefined) return val;

  return Boolean(val);
};

const coerceRelationItems = (input: CoerceRelationItemsInput) => {
  const { value, table, nested } = input;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "object" && item !== null) {
        coerceRow({
          row: item as Record<string, unknown>,
          table,
          descriptors: nested,
        });
      }
    }

    return;
  }

  if (typeof value === "object" && value !== null) {
    coerceRow({
      row: value as Record<string, unknown>,
      table,
      descriptors: nested,
    });
  }
};

// fallow-ignore-next-line complexity
const coerceRow = (input: CoerceRowInput) => {
  const { row, table, descriptors } = input;

  const boolKeys = new Set<string>();
  const jsonKeys = new Set<string>();

  for (const [key, col] of Object.entries(table.columns)) {
    if (col.type === "boolean") boolKeys.add(key);
    if (col.type === "json") jsonKeys.add(key);
    if (col.type === "jsonb") jsonKeys.add(key);
  }

  for (const key of boolKeys) {
    if (key in row) row[key] = coerceBooleanValue(row[key]);
  }

  for (const key of jsonKeys) {
    if (!(key in row)) continue;

    const val = row[key];

    if (typeof val !== "string") continue;

    row[key] = JSON.parse(val);
  }

  for (const descriptor of descriptors) {
    const value = row[descriptor.name];

    if (value === null) {
      if (descriptor.type === "hasMany") row[descriptor.name] = [];
      continue;
    }

    const nested = descriptor.nested ?? [];

    if (typeof value === "string") {
      const parsed: unknown = JSON.parse(value);
      coerceRelationItems({ value: parsed, table: descriptor.table, nested });
      row[descriptor.name] = parsed;
      continue;
    }

    // Already parsed (embedded inline in parent JSON)
    coerceRelationItems({ value, table: descriptor.table, nested });
  }
};

export const parseIncludeRows = (input: ParseIncludeRowsInput) => {
  const { table, rows, descriptors } = input;

  for (const row of rows) {
    coerceRow({ row, table, descriptors });
  }
};

const executeQuery = async (input: ExecuteQueryInput) => {
  const { sql, table, query } = input;

  const rows = [...(await sql.unsafe(query.statement, query.params))];

  parseIncludeRows({ table, rows, descriptors: query.includeDescriptors });

  return rows;
};

export const buildCreateManyQuery = <T extends Table>(
  input: BuildCreateManyQueryInput<T>,
): ReturningQuery => {
  const { spec, table, options } = input;

  if (!options.data.length) {
    return { statement: "", params: [], includeDescriptors: [] };
  }

  const nextPlaceholder = createNextPlaceholder(spec);
  const columnEntries = Object.entries(table.columns);
  const sqlNames = columnEntries.map(([, col]) => quoteIdentifier(col.sqlName));
  const params: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (const row of options.data) {
    const rowRecord = row as Record<string, unknown>;
    const placeholders: string[] = [];

    for (const [jsKey, column] of columnEntries) {
      const value = resolveCreateValue(column, rowRecord[jsKey]);
      placeholders.push(nextPlaceholder());
      params.push(serializeColumnValue(column, value));
    }

    rowPlaceholders.push(`(${placeholders.join(", ")})`);
  }

  const returning = buildSelectColumns(table, undefined);
  const statement = `INSERT INTO ${quoteIdentifier(table.sqlName)} (${sqlNames.join(", ")}) VALUES ${rowPlaceholders.join(", ")} RETURNING ${returning}`;

  return { statement, params, includeDescriptors: [] };
};

export const buildUpdateManyQuery = <T extends Table>(
  input: BuildUpdateManyQueryInput<T>,
): ReturningQuery => {
  const { spec, table, options } = input;

  const nextPlaceholder = createNextPlaceholder(spec);
  const { setClauses, params } = buildSetClauses({
    nextPlaceholder,
    table,
    data: options.data,
  });

  if (!setClauses.length) {
    throw new Error("updateMany requires at least one field in data");
  }

  const where = buildWhereClause({
    nextPlaceholder,
    table,
    where: options.where,
  });

  let statement = `UPDATE ${quoteIdentifier(table.sqlName)} SET ${setClauses.join(", ")}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  params.push(...where.params);

  const returning = buildSelectColumns(table, undefined);
  statement = `${statement} RETURNING ${returning}`;

  return { statement, params, includeDescriptors: [] };
};

export const buildDeleteManyQuery = <T extends Table>(
  input: BuildDeleteManyQueryInput<T>,
): ReturningQuery => {
  const { spec, table, options } = input;

  const nextPlaceholder = createNextPlaceholder(spec);
  const where = buildWhereClause({
    nextPlaceholder,
    table,
    where: options.where,
  });

  let statement = `DELETE FROM ${quoteIdentifier(table.sqlName)}`;

  if (where.sql) {
    statement = `${statement} WHERE ${where.sql}`;
  }

  const returning = buildSelectColumns(table, undefined);
  statement = `${statement} RETURNING ${returning}`;

  return {
    statement,
    params: where.params,
    includeDescriptors: [],
  };
};

export const createDialect = <T extends Table, R extends TableRelations>(
  input: CreateDialectInput<T, R>,
): Dialect<T, R> => {
  const { spec, table, relations, tableRelationsMap = new Map() } = input;

  const executeAndUnwrap = async (
    sql: Bun.SQL,
    query: ReturningQuery,
    operation: string,
  ) => {
    const [row] = await executeQuery({ sql, table, query });

    if (!row) {
      throw new Error(
        `Record not found after ${operation} on table ${table.sqlName}`,
      );
    }

    return row;
  };

  return {
    name: spec.name,
    findMany: async (sql, options) => {
      const query = buildFindManyQuery({
        spec,
        table,
        relations,
        options,
        tableRelationsMap,
      });

      return await executeQuery({ sql, table, query });
    },
    findFirst: async (sql, options) => {
      const query = buildFindFirstQuery({
        spec,
        table,
        relations,
        options,
        tableRelationsMap,
      });
      const [row] = await executeQuery({ sql, table, query });

      return row ?? null;
    },
    findUnique: async (sql, options) => {
      const query = buildFindUniqueQuery({
        spec,
        table,
        relations,
        options,
        tableRelationsMap,
      });
      const [row] = await executeQuery({ sql, table, query });

      return row ?? null;
    },
    create: async (sql, options) => {
      const query = buildCreateQuery({
        spec,
        table,
        relations,
        options,
        tableRelationsMap,
      });

      return executeAndUnwrap(sql, query, "insert");
    },
    createMany: async (sql, options) => {
      if (!options.data.length) {
        return [];
      }

      const query = buildCreateManyQuery({ spec, table, options });

      return await executeQuery({ sql, table, query });
    },
    update: async (sql, options) => {
      const query = buildUpdateQuery({
        spec,
        table,
        relations,
        options,
        tableRelationsMap,
      });

      return executeAndUnwrap(sql, query, "update");
    },
    updateMany: async (sql, options) => {
      const query = buildUpdateManyQuery({ spec, table, options });

      return await executeQuery({ sql, table, query });
    },
    delete: async (sql, options) => {
      const query = buildDeleteQuery({
        spec,
        table,
        relations,
        options,
        tableRelationsMap,
      });

      return executeAndUnwrap(sql, query, "delete");
    },
    deleteMany: async (sql, options) => {
      const query = buildDeleteManyQuery({ spec, table, options });

      return await executeQuery({ sql, table, query });
    },
  };
};
