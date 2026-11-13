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

  test("splitStatements keeps a SQLite trigger body in one statement", () => {
    expect(
      splitStatements(`
CREATE TRIGGER touch AFTER UPDATE ON users BEGIN
  UPDATE users SET flag = CASE WHEN NEW.flag THEN 1 ELSE 0 END WHERE id = NEW.id;
  DELETE FROM logs WHERE user_id = NEW.id;
END;
INSERT INTO t VALUES ('begin;');
`),
    ).toEqual([
      "CREATE TRIGGER touch AFTER UPDATE ON users BEGIN\n  UPDATE users SET flag = CASE WHEN NEW.flag THEN 1 ELSE 0 END WHERE id = NEW.id;\n  DELETE FROM logs WHERE user_id = NEW.id;\nEND",
      "INSERT INTO t VALUES ('begin;')",
    ]);
  });

  test("splitStatements finds a trigger after a block comment", () => {
    expect(
      splitStatements(
        "/* c */ CREATE TEMP TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; SELECT 2; END; SELECT 6;",
      ),
    ).toHaveLength(2);
  });

  test("splitStatements leaves BEGIN outside triggers alone", () => {
    expect(splitStatements("BEGIN;\nSELECT begin_at FROM t;\nCOMMIT;")).toEqual(
      ["BEGIN", "SELECT begin_at FROM t", "COMMIT"],
    );
  });

  test("splitStatements drops a trailing block comment", () => {
    expect(splitStatements("SELECT 1; /* note */")).toEqual(["SELECT 1"]);
  });

  test("splitStatements keeps empty statements out of the result", () => {
    expect(splitStatements("SELECT 1;;;\nSELECT 2;\n")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });
});
