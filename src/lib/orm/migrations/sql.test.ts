import { describe, expect, test } from "bun:test";
import { hasSqlStatement } from "./sql.js";

describe("migration sql text", () => {
  test("hasSqlStatement ignores whitespace and comments", () => {
    expect(hasSqlStatement("")).toBe(false);
    expect(hasSqlStatement("-- warning: hi\n-- still a comment\n")).toBe(false);
    expect(hasSqlStatement("/* note; */\n  ")).toBe(false);
    expect(hasSqlStatement(";\n; -- empty statements")).toBe(false);
  });

  test("hasSqlStatement finds a statement next to comments", () => {
    expect(hasSqlStatement("-- header\nSELECT 1;")).toBe(true);
    expect(hasSqlStatement("/* note */ SELECT 1")).toBe(true);
  });

  test("hasSqlStatement reads a block comment opener inside a line comment as text", () => {
    expect(hasSqlStatement("-- /*\nCREATE TABLE b (id INTEGER);\n-- */")).toBe(
      true,
    );
  });

  test("hasSqlStatement stays linear on many unclosed block comments", () => {
    const source = `/*${"a/*".repeat(200_000)}`;
    const started = performance.now();

    hasSqlStatement(source);

    expect(performance.now() - started).toBeLessThan(1000);
  });
});
