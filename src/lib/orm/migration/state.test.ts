import { describe, expect, test } from "bun:test";
import { Orm } from "../core/index.js";
import {
  ensureMigrationsTable,
  getAppliedMigrations,
  recordMigration,
  removeMigration,
} from "./state.js";

describe("migration state", () => {
  test("creates state table and records/removes migrations", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const [ensureError] = await ensureMigrationsTable(orm, "semola_migrations");
    expect(ensureError).toBeNull();
    const [recordError1] = await recordMigration(
      orm,
      "semola_migrations",
      "20260216120000",
      "init",
    );
    expect(recordError1).toBeNull();
    const [recordError2] = await recordMigration(
      orm,
      "semola_migrations",
      "20260216120100",
      "add_users",
    );
    expect(recordError2).toBeNull();

    const [appliedError, applied] = await getAppliedMigrations(
      orm,
      "semola_migrations",
    );
    expect(appliedError).toBeNull();
    expect(applied).toBeDefined();
    expect(applied?.length).toBe(2);
    expect(applied?.[0]?.version).toBe("20260216120000");
    expect(applied?.[1]?.version).toBe("20260216120100");

    const [removeError] = await removeMigration(
      orm,
      "semola_migrations",
      "20260216120100",
    );
    expect(removeError).toBeNull();

    const [afterRemoveError, afterRemove] = await getAppliedMigrations(
      orm,
      "semola_migrations",
    );
    expect(afterRemoveError).toBeNull();
    expect(afterRemove).toBeDefined();
    expect(afterRemove?.length).toBe(1);
    expect(afterRemove?.[0]?.version).toBe("20260216120000");

    orm.close();
  });

  test("escapes single quotes in migration names", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const [ensureError] = await ensureMigrationsTable(orm, "semola_migrations");
    expect(ensureError).toBeNull();
    const [recordError] = await recordMigration(
      orm,
      "semola_migrations",
      "20260216120000",
      "add user's table",
    );
    expect(recordError).toBeNull();

    const [appliedError, applied] = await getAppliedMigrations(
      orm,
      "semola_migrations",
    );
    expect(appliedError).toBeNull();
    expect(applied).toBeDefined();
    expect(applied?.length).toBe(1);
    expect(applied?.[0]?.name).toBe("add user's table");

    orm.close();
  });

  test("rejects unsafe migration table identifier", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const [error] = await ensureMigrationsTable(
      orm,
      "semola_migrations; DROP TABLE users; --",
    );
    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(error?.message).toContain("Invalid SQL table name");

    orm.close();
  });

  test("ensureMigrationsTable returns error for invalid table name", async () => {
    const orm = new Orm({ url: ":memory:", dialect: "sqlite", tables: {} });

    const [error, result] = await ensureMigrationsTable(orm, "invalid--name");

    expect(error).not.toBeNull();
    expect(error?.type).toBe("ValidationError");
    expect(result).toBeNull();

    orm.close();
  });

  test("getAppliedMigrations returns error for invalid table name", async () => {
    const orm = new Orm({ url: ":memory:", dialect: "sqlite", tables: {} });

    const [error, migrations] = await getAppliedMigrations(
      orm,
      "invalid--name",
    );

    expect(error).not.toBeNull();
    expect(migrations).toBeNull();

    orm.close();
  });

  test("recordMigration returns error for invalid table name", async () => {
    const orm = new Orm({ url: ":memory:", dialect: "sqlite", tables: {} });

    const [error, result] = await recordMigration(
      orm,
      "invalid--name",
      "123",
      "test",
    );

    expect(error).not.toBeNull();
    expect(result).toBeNull();

    orm.close();
  });

  test("removeMigration returns error for invalid table name", async () => {
    const orm = new Orm({ url: ":memory:", dialect: "sqlite", tables: {} });

    const [error, result] = await removeMigration(orm, "invalid--name", "123");

    expect(error).not.toBeNull();
    expect(result).toBeNull();

    orm.close();
  });
});
