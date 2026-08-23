import { describe, expect, test } from "bun:test";
import { splitStatements } from "./sql.js";

describe("orm migrations runner", () => {
  test("splitStatements keeps semicolons inside dollar quotes and block comments", () => {
    expect(
      splitStatements(`
SELECT 1;
/* keep ; here */
SELECT $$a;b$$;
SELECT $tag$c;d$tag$;
`),
    ).toEqual([
      "SELECT 1",
      "/* keep ; here */\nSELECT $$a;b$$",
      "SELECT $tag$c;d$tag$",
    ]);
  });

  test("splitStatements keeps doubled quotes and ignores SQL comments", () => {
    expect(
      splitStatements(`-- some comment
INSERT INTO t VALUES ('it''s');
SELECT "weird;name";
`),
    ).toEqual(["INSERT INTO t VALUES ('it''s')", `SELECT "weird;name"`]);
  });

  test("splitStatements ignores comment-only input", () => {
    expect(splitStatements("-- warning: hi\n-- still a comment\n")).toEqual([]);
  });

  test("splitStatements handles single-line comments with semicolons", () => {
    expect(
      splitStatements(`
SELECT 1; -- trailing ; here
SELECT 2;
`),
    ).toEqual(["SELECT 1", "SELECT 2"]);
  });

  test("splitStatements keeps empty statements out of the result", () => {
    expect(splitStatements("SELECT 1;;;\nSELECT 2;\n")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });
});
