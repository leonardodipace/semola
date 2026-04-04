import type { ColumnKind, Dialect } from "../../types.js";
import type { IntrospectedTable } from "../types.js";

import { buildColumnCall } from "./defaults.js";
import { toCamelCase, toVarName } from "./naming.js";
import { buildRelationsConfig, hasAnyRelations } from "./relations.js";

function collectImports(tables: IntrospectedTable[]): ColumnKind[] {
  const kinds = new Set<ColumnKind>();

  for (const table of tables) {
    for (const col of table.columns) {
      kinds.add(col.kind);
    }
  }

  return Array.from(kinds).sort();
}

function hasEnumColumns(tables: IntrospectedTable[]) {
  for (const table of tables) {
    for (const col of table.columns) {
      if (!col.enumValues) {
        continue;
      }

      if (col.enumValues.length === 0) {
        continue;
      }

      return true;
    }
  }

  return false;
}

function buildTableBlock(table: IntrospectedTable) {
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

export function generateCode(tables: IntrospectedTable[], dialect: Dialect) {
  const kinds = collectImports(tables);
  const hasEnums = hasEnumColumns(tables);
  const hasRelations = hasAnyRelations(tables);

  const kindImports = [
    "createOrm",
    "createTable",
    ...kinds,
    ...(hasEnums ? ["enumeration"] : []),
    ...(hasRelations ? ["many", "one"] : []),
  ].join(", ");

  const sections: string[] = [];

  sections.push(`import { ${kindImports} } from "semola/orm";`);

  for (const table of tables) {
    sections.push("", buildTableBlock(table));
  }

  const tableEntries = tables
    .map((table) => `  ${toCamelCase(table.name)}: ${toVarName(table.name)},`)
    .join("\n");

  const relationsBlock = buildRelationsConfig(tables);

  sections.push(
    "",
    "export const orm = createOrm({",
    '  url: process.env.DATABASE_URL ?? "",',
    `  dialect: "${dialect}",`,
    "  tables: {",
    tableEntries,
    "  },",
    ...(relationsBlock ? [relationsBlock] : []),
    "});",
  );

  return sections.join("\n");
}
