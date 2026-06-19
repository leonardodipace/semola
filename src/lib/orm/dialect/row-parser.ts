import type { Table } from "../table/types.js";
import type {
  CoerceRelationItemsInput,
  CoerceRowInput,
  IncludeDescriptor,
  ParseIncludeRowsInput,
  ReturningQuery,
} from "./types.js";

export class RowParser {
  public parseRows(input: ParseIncludeRowsInput) {
    const { table, rows, descriptors } = input;

    for (const row of rows) {
      this.coerceRow({ row, table, descriptors });
    }
  }

  public async executeQuery(sql: Bun.SQL, table: Table, query: ReturningQuery) {
    const rows = [...(await sql.unsafe(query.statement, query.params))];

    this.parseRows({ table, rows, descriptors: query.includeDescriptors });

    return rows;
  }

  private coerceRow(input: CoerceRowInput) {
    const { row, table, descriptors } = input;

    this.coerceColumnValues(row, table);
    this.coerceRelationValues(row, descriptors);
  }

  private coerceColumnValues(row: Record<string, unknown>, table: Table) {
    const { boolKeys, jsonKeys } = this.getColumnKeysByType(table);

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
  ) {
    for (const descriptor of descriptors) {
      this.coerceRelationValue({ row, descriptor });
    }
  }

  private coerceRelationValue(input: {
    row: Record<string, unknown>;
    descriptor: IncludeDescriptor;
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
      });
      row[descriptor.name] = parsed;
      return;
    }

    this.coerceRelationItems({ value, table: descriptor.table, nested });
  }

  private coerceRelationItems(input: CoerceRelationItemsInput) {
    const { value, table, nested } = input;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          this.coerceRow({
            row: item as Record<string, unknown>,
            table,
            descriptors: nested,
          });
        }
      }

      return;
    }

    if (typeof value === "object" && value !== null) {
      this.coerceRow({
        row: value as Record<string, unknown>,
        table,
        descriptors: nested,
      });
    }
  }

  private coerceBooleanValue(val: unknown) {
    if (val === null) return val;
    if (val === undefined) return val;

    return Boolean(val);
  }

  private getColumnKeysByType(table: Table) {
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
