import { describe, expect, test } from "bun:test";
import { number, string } from "../column/index.js";
import { Orm } from "../core/index.js";
import { Table } from "../table/index.js";
import { introspectSchema } from "./introspect.js";

describe("introspectSchema", () => {
  test("returns columns for existing sqlite table", async () => {
    const users = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users },
    });

    const [error, ddl] = orm.createTable(users);
    if (error) throw new Error(error.message);
    await orm.sql.unsafe(ddl);

    const [schemaError, schema] = await introspectSchema(orm, ["users"]);
    expect(schemaError).toBeNull();
    const columns = schema?.get("users");

    expect(columns?.has("id")).toBe(true);
    expect(columns?.has("name")).toBe(true);

    orm.close();
  });

  test("returns empty set for missing table", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const [schemaError, schema] = await introspectSchema(orm, [
      "unknown_table",
    ]);
    expect(schemaError).toBeNull();
    const columns = schema?.get("unknown_table");

    expect(columns).toBeDefined();
    expect(columns?.size).toBe(0);

    orm.close();
  });

  test("does not execute SQL from malicious table names", async () => {
    const users = new Table("users", {
      id: number("id").primaryKey(),
      name: string("name").notNull(),
    });

    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: { users },
    });

    const [error, ddl] = orm.createTable(users);
    if (error) throw new Error(error.message);
    await orm.sql.unsafe(ddl);

    // Malicious table names should be rejected by validation
    const [schemaError] = await introspectSchema(orm, [
      "users'; DROP TABLE users; --",
    ]);

    expect(schemaError).not.toBeNull();

    // Verify the users table still exists (wasn't dropped)
    const rows = await orm.sql.unsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
    );
    expect(Array.isArray(rows) && rows.length > 0).toBe(true);

    orm.close();
  });
});
