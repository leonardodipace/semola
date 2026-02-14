import type { Column } from "./column.js";
import type { ColumnKind } from "./types.js";

export class Table {
  private readonly sqlName: string;
  private readonly columns: Record<string, Column<ColumnKind>>;

  public constructor(
    sqlName: string,
    columns: Record<string, Column<ColumnKind>>,
  ) {
    this.sqlName = sqlName;
    this.columns = columns;
  }

  public async findMany() {
    return [];
  }
}
