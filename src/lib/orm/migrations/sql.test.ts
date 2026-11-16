import { describe, expect, test } from "bun:test";
import {
  hasSqlStatement,
  POSTGRES_COMMENT_RULES,
  SQLITE_COMMENT_RULES,
} from "./sql.js";

const sqlite = (text: string) => hasSqlStatement(text, SQLITE_COMMENT_RULES);
const postgres = (text: string) =>
  hasSqlStatement(text, POSTGRES_COMMENT_RULES);

describe("migration sql text", () => {
  test("hasSqlStatement ignores whitespace and comments", () => {
    expect(sqlite("")).toBe(false);
    expect(sqlite("-- warning: hi\n-- still a comment\n")).toBe(false);
    expect(sqlite("/* note; */\n  ")).toBe(false);
    expect(sqlite(";\n; -- empty statements")).toBe(false);
  });

  test("hasSqlStatement finds a statement next to comments", () => {
    expect(sqlite("-- header\nSELECT 1;")).toBe(true);
    expect(sqlite("/* note */ SELECT 1")).toBe(true);
  });

  test("hasSqlStatement reads a block comment opener inside a line comment as text", () => {
    expect(sqlite("-- /*\nCREATE TABLE b (id INTEGER);\n-- */")).toBe(true);
  });

  test("hasSqlStatement follows the dialect's block comment nesting", () => {
    const source = "/* outer /* inner */ -- */ CREATE TABLE t (id INTEGER);";

    // Postgres closes the outer comment at the second "*/".
    expect(postgres(source)).toBe(true);
    expect(postgres("/* a /* b */ c */")).toBe(false);

    // SQLite ends the comment at the first "*/", so "c */" is SQL text.
    expect(sqlite("/* a /* b */ c */")).toBe(true);
  });

  test("hasSqlStatement ends a line comment at a carriage return on Postgres only", () => {
    expect(postgres("-- header\rCREATE TABLE t (id INTEGER);")).toBe(true);
    expect(sqlite("-- header\rCREATE TABLE t (id INTEGER);")).toBe(false);
  });

  test("hasSqlStatement reads an unclosed comment as each database does", () => {
    // Postgres rejects it, so the file goes through and the error shows.
    expect(postgres("/* never closed")).toBe(true);

    // SQLite reads it as a comment running to the end.
    expect(sqlite("/* never closed")).toBe(false);
  });

  test("hasSqlStatement leaves Unicode spaces to the database", () => {
    expect(sqlite(" ")).toBe(true);
    expect(postgres("\v")).toBe(true);
  });

  test("hasSqlStatement stays linear on many unclosed block comments", () => {
    const source = `/*${"a/*".repeat(200_000)}`;
    const started = performance.now();

    postgres(source);
    sqlite(source);

    expect(performance.now() - started).toBeLessThan(1000);
  });
});
