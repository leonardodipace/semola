import { mightThrowSync } from "../../errors/index.js";
import type { Adapter } from "../dialect/types.js";
import { MigrationError } from "../errors.js";
import { getMigrationDialect, SCHEMA_HEADER_PREFIX } from "./dialect/index.js";
import type { MigrationOp, SchemaSnapshot } from "./types.js";

const DOLLAR_TAG = /^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/;

export const assertSchemaSnapshot = (value: unknown, label: string) => {
  if (typeof value !== "object") {
    throw new MigrationError(`Invalid ${label}: expected a schema object`);
  }

  if (value === null) {
    throw new MigrationError(`Invalid ${label}: expected a schema object`);
  }

  if (Array.isArray(value)) {
    throw new MigrationError(`Invalid ${label}: expected a schema object`);
  }

  if (!("tables" in value)) {
    throw new MigrationError(`Invalid ${label}: missing tables`);
  }

  if (typeof value.tables !== "object") {
    throw new MigrationError(`Invalid ${label}: missing tables`);
  }

  if (value.tables === null) {
    throw new MigrationError(`Invalid ${label}: missing tables`);
  }

  if (Array.isArray(value.tables)) {
    throw new MigrationError(`Invalid ${label}: missing tables`);
  }

  return value as SchemaSnapshot;
};

export const decodeSchemaHeader = (sql: string) => {
  const firstLine = (sql.split("\n")[0] ?? "").trimEnd();

  if (!firstLine.startsWith(SCHEMA_HEADER_PREFIX)) {
    return undefined;
  }

  const [error, parsed] = mightThrowSync(() => {
    return JSON.parse(firstLine.slice(SCHEMA_HEADER_PREFIX.length)) as unknown;
  });

  if (error) {
    throw new MigrationError(`Invalid schema header: ${error.message}`);
  }

  return assertSchemaSnapshot(parsed, "schema header");
};

const skipQuoted = (source: string, start: number, quote: string) => {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] !== quote) continue;
    if (source[index + 1] === quote) {
      index += 1;
      continue;
    }

    return index;
  }

  return source.length - 1;
};

const isSqlStatement = (text: string) => {
  return text.split("\n").some((line) => {
    const trimmed = line.trim();

    if (!trimmed) return false;
    if (trimmed.startsWith("--")) return false;

    return true;
  });
};

export const splitStatements = (sqlText: string) => {
  const source = sqlText.startsWith(SCHEMA_HEADER_PREFIX)
    ? sqlText.slice(sqlText.indexOf("\n") + 1)
    : sqlText;

  const statements: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    current = "";

    if (!trimmed) return;
    if (!isSqlStatement(trimmed)) return;

    statements.push(trimmed);
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (char === "'" || char === '"') {
      const end = skipQuoted(source, index, char);
      current += source.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length - 1 : newline - 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length - 1 : close + 1;
      current += source.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "$") {
      const tag = source.slice(index).match(DOLLAR_TAG)?.[1];

      if (tag) {
        const close = source.indexOf(tag, index + tag.length);
        const end = close === -1 ? source.length - 1 : close + tag.length - 1;
        current += source.slice(index, end + 1);
        index = end;
        continue;
      }
    }

    if (char === ";") {
      flush();
      continue;
    }

    current += char;
  }

  flush();

  return statements;
};

export const renderMigrationSql = (
  adapter: Adapter,
  ops: MigrationOp[],
  schemaHeader?: SchemaSnapshot,
) => {
  return getMigrationDialect(adapter).render(ops, schemaHeader);
};
