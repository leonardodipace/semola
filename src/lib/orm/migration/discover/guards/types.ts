import type { ColumnDef } from "../../../column.js";
import type { ColumnKind, ColumnMetaBase } from "../../../types.js";

export type LoadedOrm = {
  options: { url: string };
  dialect: "postgres" | "mysql" | "sqlite";
  tables: Record<
    string,
    {
      tableName: string;
      columns: Record<string, ColumnDef<ColumnKind, ColumnMetaBase, unknown>>;
    }
  >;
};
