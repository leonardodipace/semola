import type {
  HasMany,
  HasOne,
  TableOrderBy,
  TableRelations,
  TableWhere,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import { foreignKeyResolver } from "./foreign-key.js";
import { selectClauseBuilder } from "./select-clause.js";
import type {
  BuildIncludeClauseInput,
  DialectSpec,
  IncludeClause,
  IncludeDescriptor,
  RelationQueryOptions,
  RelationSubqueryResult,
} from "./types.js";
import { WhereBuilder } from "./where-builder.js";

export const EMPTY_INCLUDE: IncludeClause = {
  sql: "",
  params: [],
  descriptors: [],
};

export class IncludeBuilder {
  public build<T extends Table, R extends TableRelations>(
    input: BuildIncludeClauseInput<T, R>,
  ): IncludeClause {
    const { table, parentAlias, relations, tableRelationsMap, include } = input;

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

      const result = this.buildSubquery({
        spec: input.spec,
        nextPlaceholder: input.nextPlaceholder,
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

    return { sql: clauses.join(", "), params, descriptors };
  }

  private buildSubquery(input: {
    spec: DialectSpec;
    nextPlaceholder: () => string;
    parentTable: Table;
    parentAlias: string;
    relation: HasMany<Table> | HasOne<Table>;
    relationName: string;
    includeValue: unknown;
    tableRelationsMap: Map<Table, TableRelations>;
  }): RelationSubqueryResult {
    if (
      input.includeValue !== true &&
      !this.isRelationIncludeOptions(input.includeValue)
    ) {
      throw new Error(
        `Invalid include options for relation ${input.relationName} on table ${input.parentTable.sqlName}`,
      );
    }

    const options = this.getRelationOptions(input.includeValue);
    const relationTable = input.relation._table;
    const relationAlias = `${input.relationName}__${relationTable.sqlName}`;
    const nested = this.buildNestedPairs({
      ...input,
      relationTable,
      relationAlias,
      options,
    });

    const jsonObj = this.buildJsonObject({
      spec: input.spec,
      alias: relationAlias,
      table: relationTable,
      extraPairs: nested.nestedExtraPairs,
      select: options.select,
    });

    const where = WhereBuilder.from({
      nextPlaceholder: input.nextPlaceholder,
      table: relationTable,
      where: options.where as TableWhere<Table>,
    });

    const orderBy = selectClauseBuilder.buildOrderBy(
      relationTable,
      options.orderBy as TableOrderBy<Table>,
    );

    const pagination = selectClauseBuilder.buildPagination(
      input.spec,
      input.nextPlaceholder,
      options.take,
      options.skip,
    );

    const allParams = [
      ...nested.nestedParams,
      ...where.params,
      ...pagination.params,
    ];

    if (input.relation._type === "hasMany") {
      return this.buildHasManySubquery({
        ...input,
        relationTable,
        relationAlias,
        jsonObj,
        nestedDescriptors: nested.nestedDescriptors,
        whereSql: where.sql,
        orderBy,
        paginationSql: pagination.sql,
        allParams,
      });
    }

    return this.buildHasOneSubquery({
      ...input,
      relationTable,
      relationAlias,
      jsonObj,
      nestedDescriptors: nested.nestedDescriptors,
      whereSql: where.sql,
      allParams,
    });
  }

  private buildNestedPairs(input: {
    spec: DialectSpec;
    nextPlaceholder: () => string;
    relationTable: Table;
    relationAlias: string;
    tableRelationsMap: Map<Table, TableRelations>;
    options: RelationQueryOptions;
  }) {
    const nestedRelations =
      input.tableRelationsMap.get(input.relationTable) ?? {};
    const nestedExtraPairs: string[] = [];
    const nestedParams: unknown[] = [];
    const nestedDescriptors: IncludeDescriptor[] = [];

    if (!input.options.include) {
      return { nestedExtraPairs, nestedParams, nestedDescriptors };
    }

    for (const [nestedName, nestedValue] of Object.entries(
      input.options.include,
    )) {
      if (!nestedValue) continue;

      const nestedRelation = nestedRelations[nestedName];

      if (!nestedRelation) {
        throw new Error(
          `Unknown relation ${nestedName} on table ${input.relationTable.sqlName}`,
        );
      }

      const result = this.buildSubquery({
        spec: input.spec,
        nextPlaceholder: input.nextPlaceholder,
        parentTable: input.relationTable,
        parentAlias: input.relationAlias,
        relation: nestedRelation,
        relationName: nestedName,
        includeValue: nestedValue,
        tableRelationsMap: input.tableRelationsMap,
      });

      nestedExtraPairs.push(`'${nestedName}'`, result.sql);
      nestedParams.push(...result.params);
      nestedDescriptors.push(result.descriptor);
    }

    return { nestedExtraPairs, nestedParams, nestedDescriptors };
  }

  private buildJsonObject(input: {
    spec: DialectSpec;
    alias: string;
    table: Table;
    extraPairs?: string[];
    select?: Record<string, boolean>;
  }) {
    const allEntries = Object.entries(input.table.columns);
    const hasSelect =
      input.select !== undefined && Object.keys(input.select).length > 0;

    let visibleEntries = allEntries;

    if (hasSelect) {
      const select = input.select ?? {};

      for (const key of Object.keys(select)) {
        if (!(key in input.table.columns)) {
          throw new Error(
            `Unknown select key "${key}" on table ${input.table.sqlName}`,
          );
        }
      }

      visibleEntries = allEntries.filter(([key]) => key in select);
    }

    const pairs = visibleEntries.flatMap(([jsKey, column]) => [
      `'${jsKey}'`,
      `${input.alias}.${quoteIdentifier(column.sqlName)}`,
    ]);

    const extraPairs = input.extraPairs ?? [];

    return `${input.spec.jsonObjectFunctionName}(${[...pairs, ...extraPairs].join(", ")})`;
  }

  private buildHasManySubquery(input: {
    spec: DialectSpec;
    parentTable: Table;
    parentAlias: string;
    relationTable: Table;
    relationAlias: string;
    relationName: string;
    jsonObj: string;
    nestedDescriptors: IncludeDescriptor[];
    whereSql: string;
    orderBy: string;
    paginationSql: string;
    allParams: unknown[];
  }): RelationSubqueryResult {
    const { fk: foreignKey, source: sourceColumn } =
      foreignKeyResolver.resolveHasMany(input.parentTable, input.relationTable);

    const fkCondition = `${input.relationAlias}.${quoteIdentifier(foreignKey.sqlName)} = ${input.parentAlias}.${quoteIdentifier(sourceColumn.sqlName)}`;
    const combinedWhereSql = this.joinWhereSql(fkCondition, input.whereSql);
    const subquery = this.buildNestedHasManyQuery({
      spec: input.spec,
      relationTable: input.relationTable,
      relationAlias: input.relationAlias,
      whereSql: combinedWhereSql,
      orderBy: input.orderBy,
      paginationSql: input.paginationSql,
      jsonObj: input.jsonObj,
    });

    return {
      sql: `COALESCE((${subquery}), ${input.spec.emptyJsonArrayLiteral})`,
      params: input.allParams,
      descriptor: {
        name: input.relationName,
        type: "hasMany",
        table: input.relationTable,
        nested: input.nestedDescriptors,
      },
    };
  }

  private buildHasOneSubquery(input: {
    parentTable: Table;
    parentAlias: string;
    relation: HasMany<Table> | HasOne<Table>;
    relationTable: Table;
    relationAlias: string;
    relationName: string;
    jsonObj: string;
    nestedDescriptors: IncludeDescriptor[];
    whereSql: string;
    allParams: unknown[];
  }): RelationSubqueryResult {
    if (input.relation._type !== "hasOne") {
      throw new Error(`Expected hasOne relation for ${input.relationName}`);
    }

    const { localForeignKey, target } = foreignKeyResolver.resolveHasOne({
      sourceTable: input.parentTable,
      relationTable: input.relationTable,
      relationForeignKey: input.relation._foreignKey,
    });

    const fkCondition = `${input.relationAlias}.${quoteIdentifier(target.sqlName)} = ${input.parentAlias}.${quoteIdentifier(localForeignKey.sqlName)}`;
    const combinedWhereSql = this.joinWhereSql(fkCondition, input.whereSql);
    const subquery = `SELECT ${input.jsonObj} FROM ${quoteIdentifier(input.relationTable.sqlName)} AS ${input.relationAlias} WHERE ${combinedWhereSql} LIMIT 1`;

    return {
      sql: `(${subquery})`,
      params: input.allParams,
      descriptor: {
        name: input.relationName,
        type: "hasOne",
        table: input.relationTable,
        nested: input.nestedDescriptors,
      },
    };
  }

  private buildNestedHasManyQuery(input: {
    spec: DialectSpec;
    relationTable: Table;
    relationAlias: string;
    whereSql: string;
    orderBy: string;
    paginationSql: string;
    jsonObj: string;
  }) {
    if (!input.orderBy && !input.paginationSql) {
      return `SELECT ${input.spec.jsonArrayAggregateFunctionName}(${input.jsonObj}) FROM ${quoteIdentifier(input.relationTable.sqlName)} AS ${input.relationAlias} WHERE ${input.whereSql}`;
    }

    let innerQuery = `SELECT * FROM ${quoteIdentifier(input.relationTable.sqlName)} AS ${input.relationAlias} WHERE ${input.whereSql}`;

    if (input.orderBy) innerQuery = `${innerQuery} ORDER BY ${input.orderBy}`;

    if (input.paginationSql)
      innerQuery = `${innerQuery} ${input.paginationSql}`;

    return `SELECT ${input.spec.jsonArrayAggregateFunctionName}(${input.jsonObj}) FROM (${innerQuery}) AS ${input.relationAlias}`;
  }

  private joinWhereSql(fkCondition: string, whereSql: string) {
    if (whereSql) return `${fkCondition} AND ${whereSql}`;

    return fkCondition;
  }

  private isRelationIncludeOptions(value: unknown) {
    if (typeof value !== "object") return false;
    if (value === null) return false;
    if (Array.isArray(value)) return false;

    return true;
  }

  private getRelationOptions(includeValue: unknown) {
    const options: RelationQueryOptions = {};

    if (typeof includeValue !== "object") return options;
    if (includeValue === null) return options;

    Object.assign(options, includeValue);

    return options;
  }
}

export const includeBuilder = new IncludeBuilder();
