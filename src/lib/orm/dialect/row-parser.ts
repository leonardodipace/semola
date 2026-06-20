import type { Table } from "../table/types.js";
import type {
  CoerceRelationItemsInput,
  CoerceRowInput,
  IncludeDescriptor,
  ParseIncludeRowsInput,
  ReturningQuery,
} from "./types.js";

type ColumnKeysByType = {
  boolKeys: Set<string>;
  jsonKeys: Set<string>;
};

type ColumnKeyCache = Map<Table, ColumnKeysByType>;

export class RowParser {
  public parseRows(input: ParseIncludeRowsInput) {
    const { table, rows, descriptors } = input;
    const columnKeyCache: ColumnKeyCache = new Map();

    for (const row of rows) {
      this.coerceRow({ row, table, descriptors, columnKeyCache });
    }
  }

  public async executeQuery(sql: Bun.SQL, table: Table, query: ReturningQuery) {
    const rows = [...(await sql.unsafe(query.statement, query.params))];

    this.parseRows({ table, rows, descriptors: query.includeDescriptors });

    return rows;
  }

  private coerceRow(
    input: CoerceRowInput & {
      columnKeyCache: ColumnKeyCache;
    },
  ) {
    const { row, table, descriptors, columnKeyCache } = input;

    this.coerceColumnValues(row, table, columnKeyCache);
    this.coerceRelationValues(row, descriptors, columnKeyCache);
  }

  private coerceColumnValues(
    row: Record<string, unknown>,
    table: Table,
    columnKeyCache: ColumnKeyCache,
  ) {
    const { boolKeys, jsonKeys } = this.getCachedColumnKeysByType(
      table,
      columnKeyCache,
    );

    for (const key of boolKeys) {
      if (key in row) row[key] = this.coerceBooleanValue(row[key]);
    }

    for (const key of jsonKeys) {
      if (!(key in row)) continue;

      const val = row[key];

      if (typeof val !== "string") continue;

      row[key] = JSON.parse(val);
    }
  }

  private coerceRelationValues(
    row: Record<string, unknown>,
    descriptors: IncludeDescriptor[],
    columnKeyCache: ColumnKeyCache,
  ) {
    for (const descriptor of descriptors) {
      this.coerceRelationValue({ row, descriptor, columnKeyCache });
    }
  }

  private coerceRelationValue(input: {
    row: Record<string, unknown>;
    descriptor: IncludeDescriptor;
    columnKeyCache: ColumnKeyCache;
  }) {
    const { row, descriptor } = input;
    const value = row[descriptor.name];

    if (value === null) {
      if (descriptor.type === "hasMany") row[descriptor.name] = [];
      return;
    }

    const nested = descriptor.nested ?? [];

    if (typeof value === "string") {
      const parsed: unknown = JSON.parse(value);
      this.coerceRelationItems({
        value: parsed,
        table: descriptor.table,
        nested,
        columnKeyCache: input.columnKeyCache,
      });
      row[descriptor.name] = parsed;
      return;
    }

    this.coerceRelationItems({
      value,
      table: descriptor.table,
      nested,
      columnKeyCache: input.columnKeyCache,
    });
  }

  private coerceRelationItems(
    input: CoerceRelationItemsInput & {
      columnKeyCache: ColumnKeyCache;
    },
  ) {
    const { value, table, nested, columnKeyCache } = input;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== "object") continue;
        if (item === null) continue;

        this.coerceRow({
          row: item as Record<string, unknown>,
          table,
          descriptors: nested,
          columnKeyCache,
        });
      }

      return;
    }

    if (typeof value !== "object") return;
    if (value === null) return;

    this.coerceRow({
      row: value as Record<string, unknown>,
      table,
      descriptors: nested,
      columnKeyCache,
    });
  }

  private getCachedColumnKeysByType(
    table: Table,
    columnKeyCache: ColumnKeyCache,
  ) {
    const cached = columnKeyCache.get(table);

    if (cached) return cached;

    const columnKeys = this.getColumnKeysByType(table);
    columnKeyCache.set(table, columnKeys);

    return columnKeys;
  }

  private coerceBooleanValue(val: unknown) {
    if (val === null) return val;
    if (val === undefined) return val;

    return Boolean(val);
  }

  private getColumnKeysByType(table: Table): ColumnKeysByType {
    const boolKeys = new Set<string>();
    const jsonKeys = new Set<string>();

    for (const [key, col] of Object.entries(table.columns)) {
      if (col.type === "boolean") boolKeys.add(key);
      if (col.type === "json") jsonKeys.add(key);
      if (col.type === "jsonb") jsonKeys.add(key);
    }

    return { boolKeys, jsonKeys };
  }
}
