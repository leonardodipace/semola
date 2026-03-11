import type { ColumnKind } from "../types.js";

export type OnDeleteAction = "CASCADE" | "RESTRICT" | "SET NULL";

export type IntrospectedArrayElementKind =
  | "uuid"
  | "string"
  | "number"
  | "boolean";

export type IntrospectedColumn = {
  sqlName: string;
  kind: ColumnKind;
  enumValues?: string[] | null;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  rawDefault: string | null;
  arrayElementKind?: IntrospectedArrayElementKind | null;
  references: {
    table: string;
    column: string;
    onDelete: OnDeleteAction | null;
  } | null;
  unknownDbType: string | null;
};

export type IntrospectedTable = {
  name: string;
  columns: IntrospectedColumn[];
};
