import type { TableOrderBy, TableSelect } from "../orm/types.js";
import type { Table } from "../table/types.js";
import { quoteIdentifier } from "../utils.js";
import type {
  BuildSelectStatementInput,
  DialectSpec,
  IncludeClause,
  SqlFragment,
} from "./types.js";

export class SelectClauseBuilder {
  public buildColumns<T extends Table>(table: T, select?: TableSelect<T>) {
    if (!select) {
      const columnEntries = Object.entries(table.columns);
      const columnAliases = columnEntries.map(([key, column]) =>
        this.getColumnAlias(column.sqlName, key),
      );

      return columnAliases.join(", ");
    }

    if (Object.keys(select).length === 0) {
      const columnEntries = Object.entries(table.columns);
      const columnAliases = columnEntries.map(([key, column]) =>
        this.getColumnAlias(column.sqlName, key),
      );

      return columnAliases.join(", ");
    }

    const selectedColumns: string[] = [];
    const keys = Object.entries(select)
      .filter(([, selected]) => selected === true)
      .map(([key]) => key);

    if (!keys.length) {
      throw new Error(
        `select must include at least one selected column on table ${table.sqlName}`,
      );
    }

    for (const key of keys) {
      const column = table.columns[key];

      if (!column) {
        throw new Error(
          `Unknown select key "${key}" on table ${table.sqlName}`,
        );
      }

      selectedColumns.push(this.getColumnAlias(column.sqlName, key));
    }

    return selectedColumns.join(", ");
  }

  public buildList(columns: string, include: IncludeClause) {
    if (include.sql) return `${columns}, ${include.sql}`;

    return columns;
  }

  public buildOrderBy<T extends Table>(table: T, orderBy?: TableOrderBy<T>) {
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

      if (direction === "asc") {
        clauses.push(`${quoteIdentifier(column.sqlName)} ASC`);
        continue;
      }

      throw new Error(
        `Unknown orderBy direction "${direction}" for key "${jsKey}" on table ${table.sqlName}`,
      );
    }

    if (!clauses.length) return "";

    return clauses.join(", ");
  }

  public buildPagination(
    spec: DialectSpec,
    nextPlaceholder: () => string,
    take?: number,
    skip?: number,
  ): SqlFragment {
    const params: unknown[] = [];

    if (take === undefined) {
      if (skip === undefined) {
        return { sql: "", params };
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
      return { sql: `LIMIT ${takePh}`, params };
    }

    const skipPh = nextPlaceholder();
    params.push(skip);

    return { sql: `LIMIT ${takePh} OFFSET ${skipPh}`, params };
  }

  public buildStatement(input: BuildSelectStatementInput) {
    const { tableName, columns, where, orderBy, pagination } = input;

    let query = `SELECT ${columns} FROM ${tableName}`;

    if (where) query = `${query} WHERE ${where}`;

    if (orderBy) query = `${query} ORDER BY ${orderBy}`;

    if (pagination) query = `${query} ${pagination}`;

    return query;
  }

  private getColumnAlias(sqlName: string, jsKey: string) {
    return `${quoteIdentifier(sqlName)} AS ${quoteIdentifier(jsKey)}`;
  }
}

export const selectClauseBuilder = new SelectClauseBuilder();
