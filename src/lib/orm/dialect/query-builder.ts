import type {
  CreateManyOptions,
  CreateOptions,
  DeleteManyOptions,
  DeleteOptions,
  FindFirstOptions,
  FindManyOptions,
  FindUniqueOptions,
  TableInclude,
  TableRelations,
  TableSelect,
  TableWhere,
  UpdateManyOptions,
  UpdateOptions,
} from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import {
  buildOrderByClause,
  buildPaginationClause,
  buildSelectColumns,
  buildSelectList,
  buildSelectStatement,
  buildSetClauses,
  buildWhereClause,
  createNextPlaceholder,
  resolveCreateValue,
  serializeColumnValue,
  validateFindUniqueWhere,
} from "./clauses.js";
import { buildIncludeClause } from "./relations.js";
import type { DialectSpec, ReturningQuery } from "./types.js";

type QueryBuilderInput<T extends Table, R extends TableRelations> = {
  spec: DialectSpec;
  table: T;
  relations: R;
  tableRelationsMap?: Map<Table, TableRelations>;
};

type SelectInput<T extends Table, R extends TableRelations> = {
  where?: TableWhere<T>;
  select?: TableSelect<T>;
  include?: TableInclude<R>;
};

type ReturningInput<T extends Table, R extends TableRelations> = {
  where: TableWhere<T>;
  select?: TableSelect<T>;
  include?: TableInclude<R>;
};

export class DialectQueryBuilder<T extends Table, R extends TableRelations> {
  public readonly spec: DialectSpec;
  public readonly table: T;
  public readonly relations: R;
  public readonly tableRelationsMap: Map<Table, TableRelations>;

  public constructor(input: QueryBuilderInput<T, R>) {
    this.spec = input.spec;
    this.table = input.table;
    this.relations = input.relations;
    this.tableRelationsMap = input.tableRelationsMap ?? new Map();
  }

  public buildFindMany(options?: FindManyOptions<T, R>): ReturningQuery {
    const nextPlaceholder = createNextPlaceholder(this.spec);
    const { include, where, selectColumns } = this.buildSelectIncludeWhere(
      nextPlaceholder,
      {
        where: options?.where,
        select: options?.select,
        include: options?.include,
      },
    );
    const orderBy = buildOrderByClause(this.table, options?.orderBy);
    const pagination = buildPaginationClause({
      spec: this.spec,
      nextPlaceholder,
      take: options?.take,
      skip: options?.skip,
    });
    const params = [...include.params, ...where.params, ...pagination.params];
    const statement = buildSelectStatement({
      tableName: quoteIdentifier(this.table.sqlName),
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
  }

  public buildFindFirst(options?: FindFirstOptions<T, R>): ReturningQuery {
    return this.buildFindMany({
      ...options,
      take: 1,
    } as FindManyOptions<T, R>);
  }

  public buildFindUnique(options: FindUniqueOptions<T, R>): ReturningQuery {
    validateFindUniqueWhere(this.table, options.where);

    const nextPlaceholder = createNextPlaceholder(this.spec);
    const { include, where, selectColumns } = this.buildSelectIncludeWhere(
      nextPlaceholder,
      {
        where: options.where,
        select: options.select,
        include: options.include,
      },
    );
    const statement = buildSelectStatement({
      tableName: quoteIdentifier(this.table.sqlName),
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
  }

  public buildCreate(options: CreateOptions<T, R>): ReturningQuery {
    const nextPlaceholder = createNextPlaceholder(this.spec);
    const provided = new Map<string, unknown>(Object.entries(options.data));
    const sqlNames: string[] = [];
    const placeholders: string[] = [];
    const params: unknown[] = [];

    for (const [jsKey, column] of Object.entries(this.table.columns)) {
      const value = resolveCreateValue(column, provided.get(jsKey));

      sqlNames.push(quoteIdentifier(column.sqlName));
      placeholders.push(nextPlaceholder());
      params.push(serializeColumnValue(column, value));
    }

    const columns = buildSelectColumns(this.table, options.select);
    const include = this.buildInclude(nextPlaceholder, options.include);
    const returning = buildSelectList(columns, include);
    const statement = `INSERT INTO ${quoteIdentifier(this.table.sqlName)} (${sqlNames.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING ${returning}`;

    return {
      statement,
      params: [...params, ...include.params],
      includeDescriptors: include.descriptors,
    };
  }

  public buildUpdate(options: UpdateOptions<T, R>): ReturningQuery {
    validateFindUniqueWhere(this.table, options.where);

    const nextPlaceholder = createNextPlaceholder(this.spec);
    const { setClauses, params } = buildSetClauses({
      nextPlaceholder,
      table: this.table,
      data: options.data,
    });

    if (!setClauses.length) {
      throw new Error("update requires at least one field in data");
    }

    const { where, include, returning } = this.buildWhereIncludeReturning(
      nextPlaceholder,
      {
        where: options.where,
        select: options.select,
        include: options.include,
      },
    );

    let statement = `UPDATE ${quoteIdentifier(this.table.sqlName)} SET ${setClauses.join(", ")}`;

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
  }

  public buildDelete(options: DeleteOptions<T, R>): ReturningQuery {
    validateFindUniqueWhere(this.table, options.where);

    const nextPlaceholder = createNextPlaceholder(this.spec);
    const { where, include, returning } = this.buildWhereIncludeReturning(
      nextPlaceholder,
      {
        where: options.where,
        select: options.select,
        include: options.include,
      },
    );

    let statement = `DELETE FROM ${quoteIdentifier(this.table.sqlName)}`;

    if (where.sql) {
      statement = `${statement} WHERE ${where.sql}`;
    }

    statement = `${statement} RETURNING ${returning}`;

    return {
      statement,
      params: [...where.params, ...include.params],
      includeDescriptors: include.descriptors,
    };
  }

  public buildCreateMany(options: CreateManyOptions<T>): ReturningQuery {
    if (!options.data.length) {
      return { statement: "", params: [], includeDescriptors: [] };
    }

    const nextPlaceholder = createNextPlaceholder(this.spec);
    const columnEntries = Object.entries(this.table.columns);
    const sqlNames = columnEntries.map(([, col]) => {
      return quoteIdentifier(col.sqlName);
    });
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

    const returning = buildSelectColumns(this.table, undefined);
    const statement = `INSERT INTO ${quoteIdentifier(this.table.sqlName)} (${sqlNames.join(", ")}) VALUES ${rowPlaceholders.join(", ")} RETURNING ${returning}`;

    return { statement, params, includeDescriptors: [] };
  }

  public buildUpdateMany(options: UpdateManyOptions<T>): ReturningQuery {
    const nextPlaceholder = createNextPlaceholder(this.spec);
    const { setClauses, params } = buildSetClauses({
      nextPlaceholder,
      table: this.table,
      data: options.data,
    });

    if (!setClauses.length) {
      throw new Error("updateMany requires at least one field in data");
    }

    const where = buildWhereClause({
      nextPlaceholder,
      table: this.table,
      where: options.where,
    });

    let statement = `UPDATE ${quoteIdentifier(this.table.sqlName)} SET ${setClauses.join(", ")}`;

    if (where.sql) {
      statement = `${statement} WHERE ${where.sql}`;
    }

    params.push(...where.params);

    const returning = buildSelectColumns(this.table, undefined);
    statement = `${statement} RETURNING ${returning}`;

    return { statement, params, includeDescriptors: [] };
  }

  public buildDeleteMany(options: DeleteManyOptions<T>): ReturningQuery {
    const nextPlaceholder = createNextPlaceholder(this.spec);
    const where = buildWhereClause({
      nextPlaceholder,
      table: this.table,
      where: options.where,
    });

    let statement = `DELETE FROM ${quoteIdentifier(this.table.sqlName)}`;

    if (where.sql) {
      statement = `${statement} WHERE ${where.sql}`;
    }

    const returning = buildSelectColumns(this.table, undefined);
    statement = `${statement} RETURNING ${returning}`;

    return {
      statement,
      params: where.params,
      includeDescriptors: [],
    };
  }

  private buildInclude(
    nextPlaceholder: () => string,
    include?: TableInclude<R>,
  ) {
    return buildIncludeClause({
      spec: this.spec,
      nextPlaceholder,
      table: this.table,
      parentAlias: quoteIdentifier(this.table.sqlName),
      relations: this.relations,
      tableRelationsMap: this.tableRelationsMap,
      include,
    });
  }

  private buildSelectIncludeWhere(
    nextPlaceholder: () => string,
    input: SelectInput<T, R>,
  ) {
    const include = this.buildInclude(nextPlaceholder, input.include);
    const where = buildWhereClause({
      nextPlaceholder,
      table: this.table,
      where: input.where,
    });
    const columns = buildSelectColumns(this.table, input.select);
    const selectColumns = buildSelectList(columns, include);

    return { include, where, selectColumns };
  }

  private buildWhereIncludeReturning(
    nextPlaceholder: () => string,
    input: ReturningInput<T, R>,
  ) {
    const where = buildWhereClause({
      nextPlaceholder,
      table: this.table,
      where: input.where,
    });
    const columns = buildSelectColumns(this.table, input.select);
    const include = this.buildInclude(nextPlaceholder, input.include);
    const returning = buildSelectList(columns, include);

    return { where, include, returning };
  }
}
