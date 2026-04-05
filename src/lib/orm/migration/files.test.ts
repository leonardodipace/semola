import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMigrations, splitStatements } from "./files.js";

describe("splitStatements", () => {
  test("splits on semicolons", () => {
    const result = splitStatements("SELECT 1; SELECT 2");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  test("handles semicolons inside single-quoted string literals", () => {
    const result = splitStatements(
      "INSERT INTO t (a) VALUES ('val;ue'); SELECT 1",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("INSERT INTO t (a) VALUES ('val;ue')");
    expect(result[1]).toBe("SELECT 1");
  });

  test("handles semicolons inside double-quoted identifiers", () => {
    const result = splitStatements('SELECT "col;name" FROM t; SELECT 1');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('SELECT "col;name" FROM t');
  });

  test("filters empty chunks", () => {
    const result = splitStatements("SELECT 1;;SELECT 2");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  test("handles escaped single quotes inside string literals", () => {
    const result = splitStatements(
      "INSERT INTO t (a) VALUES ('it''s; fine'); SELECT 1;",
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toBe("INSERT INTO t (a) VALUES ('it''s; fine')");
    expect(result[1]).toBe("SELECT 1");
  });

  test("handles semicolons inside PostgreSQL dollar-quoted bodies", () => {
    const result = splitStatements(
      [
        "CREATE FUNCTION fn() RETURNS void AS $$",
        "BEGIN",
        "  PERFORM 1;",
        "END;",
        "$$ LANGUAGE plpgsql;",
        "SELECT 1;",
      ].join("\n"),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toContain("PERFORM 1;");
    expect(result[0]).toContain("$$ LANGUAGE plpgsql");
    expect(result[1]).toBe("SELECT 1");
  });
});

describe("listMigrations", () => {
  test("returns migration directories from migrations folder", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "semola-files-"));
    const migrationsDir = join(cwd, "migrations");
    const migrationDir = join(migrationsDir, "20260228231146001_init");

    await mkdir(migrationDir, { recursive: true });
    await Bun.write(join(migrationDir, "up.sql"), "SELECT 1;");
    await Bun.write(join(migrationDir, "down.sql"), "SELECT 1;");

    const migrations = await listMigrations(migrationsDir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0]?.id).toBe("20260228231146001");
    expect(migrations[0]?.name).toBe("init");
  });
});
