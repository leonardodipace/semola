import type { ColDefs } from "./types.js";

export class Table<T extends ColDefs> {
  public constructor(
    public readonly tableName: string,
    public readonly columns: T,
  ) {}
}

export function createTable<T extends ColDefs>(tableName: string, columns: T) {
  return new Table(tableName, columns);
}
