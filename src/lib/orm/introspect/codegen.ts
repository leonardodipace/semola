import type { ColumnKind, Dialect } from "../types.js";
import type { IntrospectedColumn, IntrospectedTable } from "./types.js";

function toCamelCase(sqlName: string) {
  return sqlName.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function buildColumnCall(col: IntrospectedColumn): string {
  const parts: string[] = [`${col.kind}("${col.sqlName}")`];

  if (col.primaryKey) {
    parts.push("primaryKey()");
  }

  if (!col.nullable) {
    parts.push("notNull()");
  }

  if (col.unique && !col.primaryKey) {
    parts.push("unique()");
  }

  if (col.references) {
    const onDelete = col.references.onDelete;
    if (onDelete) {
      parts.push(`onDelete("${onDelete}")`);
    }
  }

  return parts.join(".");
}

function collectImports(tables: IntrospectedTable[]): ColumnKind[] {
  const kinds = new Set<ColumnKind>();

  for (const table of tables) {
    for (const col of table.columns) {
      kinds.add(col.kind);
    }
  }

  return Array.from(kinds).sort();
}

function toVarName(tableName: string) {
  const camel = toCamelCase(tableName);
  return `${camel}Table`;
}

function buildTableBlock(table: IntrospectedTable): string {
  const varName = toVarName(table.name);
  const lines: string[] = [];

  lines.push(`const ${varName} = createTable("${table.name}", {`);

  for (const col of table.columns) {
    const jsKey = toCamelCase(col.sqlName);
    const call = buildColumnCall(col);
    const suffix = col.unknownDbType
      ? ` // TODO: unknown type: ${col.unknownDbType}`
      : "";
    lines.push(`  ${jsKey}: ${call},${suffix}`);
  }

  lines.push("});");

  return lines.join("\n");
}

export function generateCode(
  tables: IntrospectedTable[],
  dialect: Dialect,
): string {
  const kinds = collectImports(tables);
  const kindImports = ["createOrm", "createTable", ...kinds].join(", ");

  const sections: string[] = [];

  sections.push(`import { ${kindImports} } from "semola/orm";`);

  for (const table of tables) {
    sections.push("", buildTableBlock(table));
  }

  const tableEntries = tables
    .map((t) => `  ${toCamelCase(t.name)}: ${toVarName(t.name)},`)
    .join("\n");

  sections.push(
    "",
    `export const orm = createOrm({`,
    `  url: process.env.DATABASE_URL ?? "",`,
    `  dialect: "${dialect}",`,
    `  tables: {`,
    tableEntries,
    `  },`,
    `});`,
  );

  return sections.join("\n");
}
