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

    await ensureMigrationsTable(orm, "semola_migrations");
    await recordMigration(orm, "semola_migrations", "20260216120000", "init");
    await recordMigration(
      orm,
      "semola_migrations",
      "20260216120100",
      "add_users",
    );

    const applied = await getAppliedMigrations(orm, "semola_migrations");
    expect(applied.length).toBe(2);
    expect(applied[0]?.version).toBe("20260216120000");
    expect(applied[1]?.version).toBe("20260216120100");

    await removeMigration(orm, "semola_migrations", "20260216120100");

    const afterRemove = await getAppliedMigrations(orm, "semola_migrations");
    expect(afterRemove.length).toBe(1);
    expect(afterRemove[0]?.version).toBe("20260216120000");

    orm.close();
  });

  test("escapes single quotes in migration names", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    await ensureMigrationsTable(orm, "semola_migrations");
    await recordMigration(
      orm,
      "semola_migrations",
      "20260216120000",
      "add user's table",
    );

    const applied = await getAppliedMigrations(orm, "semola_migrations");
    expect(applied.length).toBe(1);
    expect(applied[0]?.name).toBe("add user's table");

    orm.close();
  });
});
