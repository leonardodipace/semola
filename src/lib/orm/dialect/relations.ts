import type { TableOrderBy, TableRelations, TableWhere } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import {
  buildOrderByClause,
  buildPaginationClause,
  buildWhereClause,
  EMPTY_INCLUDE,
} from "./clauses.js";
import {
  resolveHasManyForeignKeyColumn,
  resolveHasOneForeignKeyColumn,
} from "./relation-fk.js";
import type {
  BuildIncludeClauseInput,
  BuildJsonObjectExpressionInput,
  BuildRelationSubqueryInput,
  IncludeDescriptor,
  RelationQueryOptions,
  RelationSubqueryResult,
} from "./types.js";

const buildJsonObjectExpression = (input: BuildJsonObjectExpressionInput) => {
  const { spec, alias, table, extraPairs = [], select } = input;

  const allEntries = Object.entries(table.columns);
  const hasSelect = select !== undefined && Object.keys(select).length > 0;

  let visibleEntries = allEntries;

  if (hasSelect) {
    for (const key of Object.keys(select)) {
      if (!(key in table.columns)) {
        throw new Error(
          `Unknown select key "${key}" on table ${table.sqlName}`,
        );
      }
    }

    visibleEntries = allEntries.filter(([key]) => key in select);
  }

  const pairs = visibleEntries.flatMap(([jsKey, column]) => [
    `'${jsKey}'`,
    `${alias}.${quoteIdentifier(column.sqlName)}`,
  ]);

  return `${spec.jsonObjectFunctionName}(${[...pairs, ...extraPairs].join(", ")})`;
};

const getRelationOptions = (includeValue: unknown) => {
  let options: RelationQueryOptions = {};

  if (typeof includeValue === "object" && includeValue !== null) {
    options = includeValue as RelationQueryOptions;
  }

  return options;
};

const buildNestedIncludePairs = (
  input: BuildRelationSubqueryInput & {
    relationTable: Table;
    relationAlias: string;
    options: RelationQueryOptions;
  },
) => {
  const {
    spec,
    nextPlaceholder,
    relationTable,
    relationAlias,
    tableRelationsMap,
    options,
  } = input;
  const nestedRelations = tableRelationsMap.get(relationTable) ?? {};
  const nestedExtraPairs: string[] = [];
  const nestedParams: unknown[] = [];
  const nestedDescriptors: IncludeDescriptor[] = [];

  if (!options.include) {
    return { nestedExtraPairs, nestedParams, nestedDescriptors };
  }

  for (const [nestedName, nestedValue] of Object.entries(options.include)) {
    if (!nestedValue) continue;

    const nestedRelation = nestedRelations[nestedName];

    if (!nestedRelation) {
      throw new Error(
        `Unknown relation ${nestedName} on table ${relationTable.sqlName}`,
      );
    }

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

  return { nestedExtraPairs, nestedParams, nestedDescriptors };
};

const joinWhereSql = (fkCondition: string, whereSql: string) => {
  if (whereSql) return `${fkCondition} AND ${whereSql}`;

  return fkCondition;
};

const buildNestedHasManySubquery = (input: {
  spec: BuildRelationSubqueryInput["spec"];
  relationTable: Table;
  relationAlias: string;
  whereSql: string;
  orderBy: string;
  paginationSql: string;
  jsonObj: string;
}) => {
  const {
    spec,
    relationTable,
    relationAlias,
    whereSql,
    orderBy,
    paginationSql,
    jsonObj,
  } = input;

  if (!orderBy && !paginationSql) {
    return `SELECT ${spec.jsonArrayAggregateFunctionName}(${jsonObj}) FROM ${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias} WHERE ${whereSql}`;
  }

  let innerQuery = `SELECT * FROM ${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias} WHERE ${whereSql}`;

  if (orderBy) innerQuery = `${innerQuery} ORDER BY ${orderBy}`;

  if (paginationSql) innerQuery = `${innerQuery} ${paginationSql}`;

  return `SELECT ${spec.jsonArrayAggregateFunctionName}(${jsonObj}) FROM (${innerQuery}) AS ${relationAlias}`;
};

const buildHasManyRelationSubquery = (
  input: BuildRelationSubqueryInput & {
    relationTable: Table;
    relationAlias: string;
    jsonObj: string;
    nestedDescriptors: IncludeDescriptor[];
    whereSql: string;
    orderBy: string;
    paginationSql: string;
    allParams: unknown[];
  },
): RelationSubqueryResult => {
  const {
    spec,
    parentTable,
    parentAlias,
    relationTable,
    relationAlias,
    relationName,
    jsonObj,
    nestedDescriptors,
    whereSql,
    orderBy,
    paginationSql,
    allParams,
  } = input;

  const { fk: foreignKey, source: sourceColumn } =
    resolveHasManyForeignKeyColumn(parentTable, relationTable);

  const fkCondition = `${relationAlias}.${quoteIdentifier(foreignKey.sqlName)} = ${parentAlias}.${quoteIdentifier(sourceColumn.sqlName)}`;
  const combinedWhereSql = joinWhereSql(fkCondition, whereSql);
  const subquery = buildNestedHasManySubquery({
    spec,
    relationTable,
    relationAlias,
    whereSql: combinedWhereSql,
    orderBy,
    paginationSql,
    jsonObj,
  });

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
};

const buildHasOneRelationSubquery = (
  input: BuildRelationSubqueryInput & {
    relationTable: Table;
    relationAlias: string;
    jsonObj: string;
    nestedDescriptors: IncludeDescriptor[];
    whereSql: string;
    allParams: unknown[];
  },
): RelationSubqueryResult => {
  const {
    parentTable,
    parentAlias,
    relation,
    relationTable,
    relationAlias,
    relationName,
    jsonObj,
    nestedDescriptors,
    whereSql,
    allParams,
  } = input;

  if (relation._type !== "hasOne") {
    throw new Error(`Expected hasOne relation for ${relationName}`);
  }

  const { localForeignKey, target } = resolveHasOneForeignKeyColumn({
    sourceTable: parentTable,
    relationTable,
    relationForeignKey: relation._foreignKey,
  });

  const fkCondition = `${relationAlias}.${quoteIdentifier(target.sqlName)} = ${parentAlias}.${quoteIdentifier(localForeignKey.sqlName)}`;
  const combinedWhereSql = joinWhereSql(fkCondition, whereSql);
  const subquery = `SELECT ${jsonObj} FROM ${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias} WHERE ${combinedWhereSql} LIMIT 1`;

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

const buildRelationSubquery = (
  input: BuildRelationSubqueryInput,
): RelationSubqueryResult => {
  const { spec, nextPlaceholder, relation, relationName } = input;
  const options = getRelationOptions(input.includeValue);
  const relationTable = relation._table;
  const relationAlias = `${relationName}__${relationTable.sqlName}`;
  const { nestedExtraPairs, nestedParams, nestedDescriptors } =
    buildNestedIncludePairs({
      ...input,
      relationTable,
      relationAlias,
      options,
    });

  const jsonObj = buildJsonObjectExpression({
    spec,
    alias: relationAlias,
    table: relationTable,
    extraPairs: nestedExtraPairs,
    select: options.select,
  });

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
    return buildHasManyRelationSubquery({
      ...input,
      relationTable,
      relationAlias,
      jsonObj,
      nestedDescriptors,
      whereSql: where.sql,
      orderBy,
      paginationSql: pagination.sql,
      allParams,
    });
  }

  return buildHasOneRelationSubquery({
    ...input,
    relationTable,
    relationAlias,
    jsonObj,
    nestedDescriptors,
    whereSql: where.sql,
    allParams,
  });
};

export const buildIncludeClause = <T extends Table, R extends TableRelations>(
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
  };
};
