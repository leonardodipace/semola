import type { Column } from "../column/types.js";
import type {
  HasMany,
  HasOne,
  TableRelations,
  TableWhere,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import { foreignKeyResolver } from "./foreign-key.js";
import { serializeColumnValue, serializeParam } from "./sql-helpers.js";
import type {
  BuildWhereClauseInput,
  CollectedLogicalWhere,
  LogicalJoinOperator,
  LogicalNotOperator,
  LogicalWhereJoinKey,
  LogicalWhereKey,
  ParsedRelationFilter,
  SqlFragment,
} from "./types.js";

const FALSE_WHERE_SQL = "(1 = 0)";
const TRUE_WHERE_SQL = "(1 = 1)";
const RELATION_FILTER_KEYS = ["every", "some", "none"] as const;

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

export class WhereBuilder<
  T extends Table,
  R extends TableRelations = Record<never, never>,
> {
  private clauses: string[] = [];
  private params: unknown[] = [];

  private constructor(
    private table: T,
    private relations: R | undefined,
    private parentAlias: string | undefined,
    private nextPlaceholder: () => string,
  ) {}

  public static from<T extends Table, R extends TableRelations>(
    input: BuildWhereClauseInput<T, R>,
  ): SqlFragment {
    const builder = new WhereBuilder(
      input.table,
      input.relations,
      input.parentAlias,
      input.nextPlaceholder,
    );

    return builder.build(input.where);
  }

  public build(where?: TableWhere<T, R>): SqlFragment {
    if (!where) return { sql: "", params: [] };

    for (const [jsKey, value] of Object.entries(where)) {
      if (value === undefined) continue;

      const logicalKey = this.getLogicalWhereKey(jsKey);

      if (logicalKey) {
        this.appendLogical(logicalKey, value);
        continue;
      }

      const relation = this.relations?.[jsKey];

      if (relation && this.isRelationFilterValue(value)) {
        this.appendRelation({
          relation,
          relationName: jsKey,
          value,
          parentAlias: this.parentAlias ?? quoteIdentifier(this.table.sqlName),
        });
        continue;
      }

      this.appendField(jsKey, value);
    }

    const operator: LogicalJoinOperator = "AND";
    const sql = this.clauses.join(` ${operator} `);

    return { sql, params: this.params };
  }

  private appendField(jsKey: string, value: unknown) {
    if (!(jsKey in this.table.columns)) {
      throw new Error(
        `Unknown where key "${jsKey}" on table ${this.table.sqlName}`,
      );
    }

    const column = this.table.columns[jsKey];

    if (!column) {
      throw new Error(
        `Unknown where key "${jsKey}" on table ${this.table.sqlName}`,
      );
    }

    const sqlName = quoteIdentifier(column.sqlName);

    if (!isPlainObject(value)) {
      this.appendDirect(column, sqlName, value);
      return;
    }

    this.appendOperators(
      column,
      sqlName,
      jsKey,
      value as Record<string, unknown>,
    );
  }

  private appendDirect(column: Column, sqlName: string, value: unknown) {
    if (value === null) {
      this.clauses.push(`${sqlName} IS NULL`);
      return;
    }

    this.clauses.push(`${sqlName} = ${this.nextPlaceholder()}`);
    this.params.push(serializeColumnValue(column, value));
  }

  private appendOperators(
    column: Column,
    sqlName: string,
    jsKey: string,
    value: Record<string, unknown>,
  ) {
    const entries = Object.entries(value);

    if (!entries.length) {
      throw new Error(`Missing where operator for field ${jsKey}`);
    }

    for (const [op, operand] of entries) {
      if (op === "in" || op === "notIn") {
        this.appendInOperator(column, sqlName, jsKey, op, operand);
        continue;
      }

      if (op === "between") {
        this.appendBetweenOperator(column, sqlName, jsKey, operand);
        continue;
      }

      const operator = OPERATORS[op as keyof typeof OPERATORS];

      if (!operator) {
        throw new Error(`Unknown where operator: ${op} for field ${jsKey}`);
      }

      if (op === "equals" && operand === null) {
        this.clauses.push(`${sqlName} IS NULL`);
        continue;
      }

      this.clauses.push(`${sqlName} ${operator.sql(this.nextPlaceholder())}`);
      this.params.push(
        operator.transform(serializeColumnValue(column, operand)),
      );
    }
  }

  private appendInOperator(
    column: Column,
    sqlName: string,
    jsKey: string,
    op: string,
    operand: unknown,
  ) {
    if (!Array.isArray(operand)) {
      throw new Error(
        `Expected array for where operator: ${op} for field ${jsKey}`,
      );
    }

    if (op === "in" && operand.length === 0) {
      this.clauses.push(FALSE_WHERE_SQL);
      return;
    }

    if (op === "notIn" && operand.length === 0) {
      return;
    }

    const placeholders = operand.map(() => this.nextPlaceholder());
    const keyword = op === "in" ? "IN" : "NOT IN";

    this.clauses.push(`${sqlName} ${keyword} (${placeholders.join(", ")})`);

    for (const item of operand) {
      this.params.push(serializeColumnValue(column, item));
    }
  }

  private appendBetweenOperator(
    column: Column,
    sqlName: string,
    jsKey: string,
    operand: unknown,
  ) {
    if (!Array.isArray(operand)) {
      throw new Error(
        `Expected array for where operator: between for field ${jsKey}`,
      );
    }

    if (operand.length !== 2) {
      throw new Error(
        `Expected 2-element array for where operator: between for field ${jsKey}`,
      );
    }

    const [min, max] = operand;
    const ph1 = this.nextPlaceholder();
    const ph2 = this.nextPlaceholder();

    this.clauses.push(`${sqlName} BETWEEN ${ph1} AND ${ph2}`);
    this.params.push(
      serializeColumnValue(column, min),
      serializeColumnValue(column, max),
    );
  }

  private appendLogical(jsKey: LogicalWhereKey, value: unknown) {
    const collected = this.collectLogicalClauses(jsKey, value);

    if (typeof collected === "string") {
      this.clauses.push(collected);
      return;
    }

    if (!collected.nestedClauses.length) return;

    this.params.push(...collected.nestedParams);

    if (jsKey === "$not") {
      const operator: LogicalNotOperator = "NOT";
      const joinOperator: LogicalJoinOperator = "AND";
      const negatedClauses = collected.nestedClauses.map(
        (nestedClause) => `${operator} (${nestedClause})`,
      );
      const combinedNegatedClause = negatedClauses.join(` ${joinOperator} `);

      this.clauses.push(combinedNegatedClause);

      return;
    }

    const operator = this.getLogicalOperator(jsKey);

    this.clauses.push(`(${collected.nestedClauses.join(` ${operator} `)})`);
  }

  private collectLogicalClauses(
    jsKey: LogicalWhereKey,
    value: unknown,
  ): CollectedLogicalWhere {
    const values = this.getLogicalWhereValues(jsKey, value);
    const nestedClauses: string[] = [];
    const nestedParams: unknown[] = [];

    for (const nestedValue of values) {
      if (!isPlainObject(nestedValue)) {
        throw new Error(`${jsKey} where value must contain object filters`);
      }

      const nested = WhereBuilder.from({
        nextPlaceholder: this.nextPlaceholder,
        table: this.table,
        where: nestedValue as TableWhere<T>,
        relations: this.relations,
        parentAlias: this.parentAlias,
      });

      if (!nested.sql) {
        if (jsKey === "$or") return TRUE_WHERE_SQL;

        continue;
      }

      nestedClauses.push(`(${nested.sql})`);
      nestedParams.push(...nested.params);
    }

    if (jsKey === "$or" && !nestedClauses.length) return FALSE_WHERE_SQL;

    return { nestedClauses, nestedParams };
  }

  private appendRelation(input: {
    relation: HasMany<Table> | HasOne<Table>;
    relationName: string;
    value: unknown;
    parentAlias: string;
  }) {
    const filters = this.parseRelationFilters(input.relationName, input.value);

    for (const filter of filters) {
      this.appendRelationFilter({
        ...input,
        ...filter,
      });
    }
  }

  private appendRelationFilter(input: {
    relation: HasMany<Table> | HasOne<Table>;
    relationName: string;
    parentAlias: string;
    key: ParsedRelationFilter["key"];
    where: TableWhere<Table>;
  }) {
    const relationTable = input.relation._table;
    const relationAlias = `where_${input.relationName}__${relationTable.sqlName}`;
    const fkCondition = this.buildRelationForeignKeyCondition({
      relation: input.relation,
      relationTable,
      relationAlias,
      parentAlias: input.parentAlias,
    });
    const nested = WhereBuilder.from({
      nextPlaceholder: this.nextPlaceholder,
      table: relationTable,
      where: input.where,
    });
    const nestedCondition = nested.sql ? nested.sql : TRUE_WHERE_SQL;

    this.params.push(...nested.params);

    const relationFrom = `${quoteIdentifier(relationTable.sqlName)} AS ${relationAlias}`;

    if (input.key === "some") {
      this.clauses.push(
        `EXISTS (SELECT 1 FROM ${relationFrom} WHERE ${fkCondition} AND (${nestedCondition}))`,
      );

      return;
    }

    if (input.key === "none") {
      this.clauses.push(
        `NOT EXISTS (SELECT 1 FROM ${relationFrom} WHERE ${fkCondition} AND (${nestedCondition}))`,
      );

      return;
    }

    this.clauses.push(
      `NOT EXISTS (SELECT 1 FROM ${relationFrom} WHERE ${fkCondition} AND NOT (${nestedCondition}))`,
    );
  }

  private buildRelationForeignKeyCondition(input: {
    relation: HasMany<Table> | HasOne<Table>;
    relationTable: Table;
    relationAlias: string;
    parentAlias: string;
  }) {
    if (input.relation._type === "hasMany") {
      const { fk: foreignKey, source: sourceColumn } =
        foreignKeyResolver.resolveHasMany(this.table, input.relationTable);

      return `${input.relationAlias}.${quoteIdentifier(foreignKey.sqlName)} = ${input.parentAlias}.${quoteIdentifier(sourceColumn.sqlName)}`;
    }

    if (input.relation._type !== "hasOne") {
      throw new Error("Expected hasOne relation");
    }

    const { localForeignKey, target } = foreignKeyResolver.resolveHasOne({
      sourceTable: this.table,
      relationTable: input.relationTable,
      relationForeignKey: input.relation._foreignKey,
    });

    return `${input.relationAlias}.${quoteIdentifier(target.sqlName)} = ${input.parentAlias}.${quoteIdentifier(localForeignKey.sqlName)}`;
  }

  private parseRelationFilters(
    relationName: string,
    value: unknown,
  ): ParsedRelationFilter[] {
    if (!isPlainObject(value)) {
      throw new Error(
        `Relation where filter for ${relationName} must be an object`,
      );
    }

    const filter = value as Record<string, unknown>;
    const filters: ParsedRelationFilter[] = [];

    for (const filterKey of RELATION_FILTER_KEYS) {
      if (!(filterKey in filter)) continue;

      const nestedWhere = filter[filterKey];

      if (!isPlainObject(nestedWhere)) {
        throw new Error(`Relation where filter ${filterKey} must be an object`);
      }

      filters.push({ key: filterKey, where: nestedWhere as TableWhere<Table> });
    }

    const allowedKeys = new Set<string>(RELATION_FILTER_KEYS);
    const unknownKeys = Object.keys(filter).filter(
      (key) => !allowedKeys.has(key),
    );

    if (unknownKeys.length) {
      throw new Error(
        `Relation where filter for ${relationName} has unknown operators: ${unknownKeys.join(", ")}`,
      );
    }

    if (filters.length === 0) {
      throw new Error(
        `Relation where filter for ${relationName} must include at least one of every, some, or none`,
      );
    }

    return filters;
  }

  private isRelationFilterValue(value: unknown) {
    if (!isPlainObject(value)) return false;

    const filter = value as Record<string, unknown>;

    for (const key of RELATION_FILTER_KEYS) {
      if (key in filter) return true;
    }

    return Object.keys(filter).length === 0;
  }

  private getLogicalWhereKey(jsKey: string): LogicalWhereKey | null {
    if (jsKey === "$and") return jsKey;
    if (jsKey === "$not") return jsKey;
    if (jsKey === "$or") return jsKey;

    return null;
  }

  private getLogicalOperator(jsKey: LogicalWhereJoinKey): LogicalJoinOperator {
    if (jsKey === "$or") return "OR";

    return "AND";
  }

  private getLogicalWhereValues(jsKey: LogicalWhereKey, value: unknown) {
    if (jsKey === "$or" && !Array.isArray(value)) {
      throw new Error("$or where value must be an array");
    }

    if (Array.isArray(value)) return value;

    return [value];
  }
}
