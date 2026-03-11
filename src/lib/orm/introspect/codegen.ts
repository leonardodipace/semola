import type { ColumnKind, Dialect } from "../types.js";
import type { IntrospectedColumn, IntrospectedTable } from "./types.js";

function toCamelCase(sqlName: string) {
  return sqlName.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function stripWrappingParens(value: string) {
  const trimmed = value.trim();

  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return trimmed;
  }

  return trimmed.slice(1, -1).trim();
}

function parseStringLiteral(input: string) {
  const trimmed = input.trim();

  if (!trimmed.startsWith("'")) {
    return null;
  }

  let out = "";
  let index = 1;

  while (index < trimmed.length) {
    const char = trimmed[index];

    if (char === "'") {
      const next = trimmed[index + 1];

      if (next === "'") {
        out += "'";
        index += 2;
        continue;
      }

      const rest = trimmed.slice(index + 1).trim();
      if (rest.length === 0 || rest.startsWith("::")) {
        return out;
      }

      return null;
    }

    out += char;
    index++;
  }

  return null;
}

function mapRawDefaultToChain(col: IntrospectedColumn) {
  const rawDefault = col.rawDefault;

  if (!rawDefault) {
    return null;
  }

  const raw = rawDefault.trim();
  const lower = raw.toLowerCase();
  const unwrapped = stripWrappingParens(raw);
  const unwrappedLower = unwrapped.toLowerCase();

  if (col.kind === "uuid") {
    if (
      unwrappedLower.includes("gen_random_uuid()") ||
      unwrappedLower.includes("uuid_generate_v4()") ||
      unwrappedLower === "uuid()"
    ) {
      return "defaultFn(() => crypto.randomUUID())";
    }
  }

  if (col.kind === "date") {
    if (
      unwrappedLower === "now()" ||
      unwrappedLower === "current_timestamp" ||
      unwrappedLower === "current_timestamp()" ||
      unwrappedLower === "datetime('now')"
    ) {
      return "defaultFn(() => new Date())";
    }
  }

  const parsedString = parseStringLiteral(raw);
  if (parsedString !== null) {
    return `default(${JSON.stringify(parsedString)})`;
  }

  if (col.kind === "boolean") {
    if (
      lower === "true" ||
      lower === "false" ||
      unwrappedLower === "true" ||
      unwrappedLower === "false"
    ) {
      return `default(${unwrappedLower})`;
    }

    if (unwrapped === "1") {
      return "default(true)";
    }

    if (unwrapped === "0") {
      return "default(false)";
    }
  }

  if (col.kind === "number") {
    if (/^-?\d+(\.\d+)?$/.test(unwrapped)) {
      return `default(${unwrapped})`;
    }
  }

  return null;
}

function buildColumnCall(col: IntrospectedColumn): string {
  const parts: string[] = [`${col.kind}("${col.sqlName}")`];

  if (col.primaryKey) {
    parts.push("primaryKey()");
  }

  const defaultChain = mapRawDefaultToChain(col);
  if (defaultChain) {
    parts.push(defaultChain);
  }

  if (!col.nullable && !col.primaryKey) {
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
