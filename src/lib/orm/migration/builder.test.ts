import { describe, expect, test } from "bun:test";
import { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { SchemaBuilder } from "./builder.js";

const tableExists = async (orm: Orm<Record<string, Table>>, name: string) => {
  const rows = await orm.sql.unsafe(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`,
  );
  return Array.isArray(rows) && rows.length > 0;
};

describe("SchemaBuilder", () => {
  test("createTable and dropTable", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
      t.string("name").notNull();
    });

    expect(await tableExists(orm, "users")).toBe(true);

    await schema.dropTable("users");

    expect(await tableExists(orm, "users")).toBe(false);
    orm.close();
  });

  test("addColumn and dropColumn", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
    });

    await schema.addColumn("users", (t) => {
      t.string("email").notNull();
    });

    const withColumnRows = await orm.sql.unsafe("PRAGMA table_info('users')");
    const withColumn = Array.isArray(withColumnRows)
      ? withColumnRows.some((row) => {
          const columnName = Reflect.get(row as object, "name");
          return columnName === "email";
        })
      : false;

    expect(withColumn).toBe(true);

    await schema.dropColumn("users", "email");

    const afterDropRows = await orm.sql.unsafe("PRAGMA table_info('users')");
    const hasDroppedColumn = Array.isArray(afterDropRows)
      ? afterDropRows.some((row) => {
          const columnName = Reflect.get(row as object, "name");
          return columnName === "email";
        })
      : false;

    expect(hasDroppedColumn).toBe(false);
    orm.close();
  });

  test("createIndex and dropIndex", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
      t.string("email").notNull();
    });

    await schema.createIndex("users", ["email"], {
      name: "users_email_idx",
      unique: true,
    });

    const indexes = await orm.sql.unsafe("PRAGMA index_list('users')");
    const hasIndex = Array.isArray(indexes)
      ? indexes.some((row) => {
          const name = Reflect.get(row as object, "name");
          return name === "users_email_idx";
        })
      : false;

    expect(hasIndex).toBe(true);

    await schema.dropIndex("users_email_idx");

    const indexesAfter = await orm.sql.unsafe("PRAGMA index_list('users')");
    const hasIndexAfter = Array.isArray(indexesAfter)
      ? indexesAfter.some((row) => {
          const name = Reflect.get(row as object, "name");
          return name === "users_email_idx";
        })
      : false;

    expect(hasIndexAfter).toBe(false);
    orm.close();
  });

  test("alterColumn throws on sqlite", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
      t.string("email").notNull();
    });

    await expect(
      schema.alterColumn("users", "email", (t) => {
        t.string("email").unique();
      }),
    ).rejects.toThrow("alterColumn is not supported for sqlite");

    orm.close();
  });
});
