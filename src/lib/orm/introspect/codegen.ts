import type { ColumnKind, Dialect } from "../types.js";
import type { IntrospectedColumn, IntrospectedTable } from "./types.js";

function toCamelCase(sqlName: string) {
  return sqlName.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function toPascalCase(sqlName: string) {
  const camel = toCamelCase(sqlName);
  const first = camel[0];

  if (!first) {
    return camel;
  }

  return `${first.toUpperCase()}${camel.slice(1)}`;
}

function toTypeLiteral(value: string) {
  return JSON.stringify(value);
}

function buildEnumValues(values: string[]) {
  return `[${values.map((value) => toTypeLiteral(value)).join(", ")}]`;
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

function parseArrayToken(
  token: string,
  elementKind: NonNullable<IntrospectedColumn["arrayElementKind"]>,
) {
  let value = stripWrappingParens(token.trim());

  const castIndex = value.indexOf("::");
  if (castIndex > -1) {
    value = value.slice(0, castIndex).trim();
  }

  const parsedString = parseStringLiteral(value);
  if (parsedString !== null) {
    return parsedString;
  }

  if (elementKind === "number") {
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return Number(value);
    }

    return null;
  }

  if (elementKind === "boolean") {
    const lower = value.toLowerCase();
    if (lower === "true" || value === "1") {
      return true;
    }

    if (lower === "false" || value === "0") {
      return false;
    }

    return null;
  }

  return value;
}

function parseArrayDefaultValues(
  rawDefault: string,
  elementKind: NonNullable<IntrospectedColumn["arrayElementKind"]>,
) {
  const trimmed = rawDefault.trim();

  if (!trimmed.startsWith("ARRAY[")) {
    return null;
  }

  const startIndex = trimmed.indexOf("[");
  let endIndex = -1;

  let depth = 0;
  let inString = false;

  for (let index = startIndex; index < trimmed.length; index++) {
    const char = trimmed[index];

    if (char === "'") {
      if (inString && trimmed[index + 1] === "'") {
        index++;
        continue;
      }

      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "[") {
      depth++;
      continue;
    }

    if (char === "]") {
      depth--;

      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  const inner = trimmed.slice(startIndex + 1, endIndex);

  if (inner.trim().length === 0) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let tokenInString = false;
  let index = 0;

  while (index < inner.length) {
    const char = inner[index];

    if (char === "'") {
      if (tokenInString && inner[index + 1] === "'") {
        current += "''";
        index += 2;
        continue;
      }

      tokenInString = !tokenInString;
      current += char;
      index++;
      continue;
    }

    if (char === "," && !tokenInString) {
      tokens.push(current);
      current = "";
      index++;
      continue;
    }

    current += char;
    index++;
  }

  tokens.push(current);

  const out: Array<string | number | boolean> = [];

  for (const token of tokens) {
    const parsed = parseArrayToken(token, elementKind);

    if (parsed === null) {
      return null;
    }

    if (
      typeof parsed !== "string" &&
      typeof parsed !== "number" &&
      typeof parsed !== "boolean"
    ) {
      return null;
    }

    out.push(parsed);
  }

  return out;
}

function buildColumnFactory(col: IntrospectedColumn) {
  if (col.enumValues && col.enumValues.length > 0) {
    const enumValues = buildEnumValues(col.enumValues);
    return `enumeration("${col.sqlName}", ${enumValues})`;
  }

  return `${col.kind}("${col.sqlName}")`;
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

  if (col.arrayElementKind) {
    const values = parseArrayDefaultValues(raw, col.arrayElementKind);

    if (values) {
      return `default(${JSON.stringify(values)})`;
    }

    return null;
  }

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
  const parts: string[] = [buildColumnFactory(col)];

  if (col.arrayElementKind) {
    parts.push("asArray()");
  }

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

function toVarName(tableName: string) {
  const camel = toCamelCase(tableName);
  return `${camel}Table`;
}

function findTableByName(tables: IntrospectedTable[], tableName: string) {
  for (const table of tables) {
    if (table.name === tableName) {
      return table;
    }
  }

  return null;
}

function toOneRelationBaseName(sqlName: string) {
  if (sqlName.endsWith("_id") && sqlName.length > 3) {
    return sqlName.slice(0, -3);
  }

  return sqlName;
}

function toUniqueRelationKey(
  baseKey: string,
  used: Set<string>,
  suffix: string,
) {
  if (!used.has(baseKey)) {
    used.add(baseKey);
    return baseKey;
  }

  const suffixed = `${baseKey}By${toPascalCase(suffix)}`;

  if (!used.has(suffixed)) {
    used.add(suffixed);
    return suffixed;
  }

  let index = 2;

  while (used.has(`${suffixed}${index}`)) {
    index++;
  }

  const indexed = `${suffixed}${index}`;
  used.add(indexed);
  return indexed;
}

function buildRelationEntriesForTable(
  table: IntrospectedTable,
  tables: IntrospectedTable[],
) {
  const used = new Set<string>();
  const entries: string[] = [];

  for (const col of table.columns) {
    if (!col.references) {
      continue;
    }

    const targetTable = findTableByName(tables, col.references.table);

    if (!targetTable) {
      continue;
    }

    const oneKeyBase = toCamelCase(toOneRelationBaseName(col.sqlName));
    const oneKey = toUniqueRelationKey(oneKeyBase, used, col.sqlName);

    entries.push(
      `      ${oneKey}: one("${col.sqlName}", () => ${toVarName(targetTable.name)}),`,
    );
  }

  for (const sourceTable of tables) {
    for (const sourceCol of sourceTable.columns) {
      if (!sourceCol.references) {
        continue;
      }

      if (sourceCol.references.table !== table.name) {
        continue;
      }

      const manyKeyBase = toCamelCase(sourceTable.name);
      const manyKey = toUniqueRelationKey(manyKeyBase, used, sourceCol.sqlName);

      entries.push(
        `      ${manyKey}: many(() => ${toVarName(sourceTable.name)}, "${sourceCol.sqlName}"),`,
      );
    }
  }

  return entries;
}

function hasAnyRelations(tables: IntrospectedTable[]) {
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.references) {
        return true;
      }
    }
  }

  return false;
}

function buildRelationsConfig(tables: IntrospectedTable[]) {
  const lines: string[] = [];

  for (const table of tables) {
    const relationEntries = buildRelationEntriesForTable(table, tables);

    if (relationEntries.length === 0) {
      continue;
    }

    if (lines.length === 0) {
      lines.push("  relations: {");
    }

    lines.push(`    ${toCamelCase(table.name)}: {`);

    for (const relationEntry of relationEntries) {
      lines.push(relationEntry);
    }

    lines.push("    },");
  }

  if (lines.length === 0) {
    return null;
  }

  lines.push("  },");

  return lines.join("\n");
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
    .map((t) => `  ${toCamelCase(t.name)}: ${toVarName(t.name)},`)
    .join("\n");

  const relationsBlock = buildRelationsConfig(tables);

  sections.push(
    "",
    `export const orm = createOrm({`,
    `  url: process.env.DATABASE_URL ?? "",`,
    `  dialect: "${dialect}",`,
    `  tables: {`,
    tableEntries,
    `  },`,
    ...(relationsBlock ? [relationsBlock] : []),
    `});`,
  );

  return sections.join("\n");
}
