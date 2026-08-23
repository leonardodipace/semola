import type { Adapter } from "../dialect/types.js";
import { MigrationError } from "../errors.js";
import { getMigrationDialect } from "./dialect/index.js";
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
  const statements: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    current = "";

    if (!trimmed) return;
    if (!isSqlStatement(trimmed)) return;

    statements.push(trimmed);
  };

  for (let index = 0; index < sqlText.length; index++) {
    const char = sqlText[index] ?? "";
    const next = sqlText[index + 1] ?? "";

    if (char === "'" || char === '"') {
      const end = skipQuoted(sqlText, index, char);
      current += sqlText.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "-" && next === "-") {
      const newline = sqlText.indexOf("\n", index);
      index = newline === -1 ? sqlText.length - 1 : newline - 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = sqlText.indexOf("*/", index + 2);
      const end = close === -1 ? sqlText.length - 1 : close + 1;
      current += sqlText.slice(index, end + 1);
      index = end;
      continue;
    }

    if (char === "$") {
      const tag = sqlText.slice(index).match(DOLLAR_TAG)?.[1];

      if (tag) {
        const close = sqlText.indexOf(tag, index + tag.length);
        const end = close === -1 ? sqlText.length - 1 : close + tag.length - 1;
        current += sqlText.slice(index, end + 1);
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

export const renderMigrationSql = (adapter: Adapter, ops: MigrationOp[]) => {
  return getMigrationDialect(adapter).render(ops);
};
