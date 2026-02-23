import { describe, expect, test } from "bun:test";
import { Orm } from "../core/index.js";
import type { Table } from "../table/index.js";
import { SchemaBuilder } from "./builder.js";

const hasColumn = (rows: unknown, colName: string) => {
  if (!Array.isArray(rows)) return false;
  return rows.some(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      "name" in row &&
      row.name === colName,
  );
};

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
    await orm.close();
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
    const withColumn = hasColumn(withColumnRows, "email");

    expect(withColumn).toBe(true);

    await schema.dropColumn("users", "email");

    const afterDropRows = await orm.sql.unsafe("PRAGMA table_info('users')");
    const hasDroppedColumn = hasColumn(afterDropRows, "email");

    expect(hasDroppedColumn).toBe(false);
    await orm.close();
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
    const hasIndex = hasColumn(indexes, "users_email_idx");

    expect(hasIndex).toBe(true);

    await schema.dropIndex("users_email_idx");

    const indexesAfter = await orm.sql.unsafe("PRAGMA index_list('users')");
    const hasIndexAfter = hasColumn(indexesAfter, "users_email_idx");

    expect(hasIndexAfter).toBe(false);
    await orm.close();
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

    const [error] = await schema.alterColumn("users", "email", (t) => {
      t.string("email").unique();
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("alterColumn is not supported for sqlite");

    await orm.close();
  });

  test("rejects unsafe table identifier", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    const [error] = await schema.createTable(
      "users; DROP TABLE users; --",
      (t) => {
        t.number("id").primaryKey();
      },
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Invalid SQL table name");

    await orm.close();
  });

  test("returns error for unsafe column identifier", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
    });

    const [error] = await schema.addColumn("users", (t) => {
      t.string("email; DROP TABLE users; --");
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Invalid SQL column name");

    await orm.close();
  });

  test("rejects unsafe index identifier", async () => {
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

    const [error] = await schema.createIndex("users", ["email"], {
      name: "users_email_idx; DROP TABLE users; --",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Invalid SQL index name");

    await orm.close();
  });

  test("formatDefaultValue handles circular JSON references", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    // Create circular object
    interface Circular {
      name: string;
      self?: Circular;
    }

    const circular: Circular = { name: "test" };
    circular.self = circular;

    // Create table first
    await schema.createTable("test", (table) => {
      table.number("id").primaryKey();
    });

    // This should not throw when adding column with circular JSON default
    await schema.addColumn("test", (table) => {
      table.json("data").default(circular);
    });

    // Verify column was added (circular refs replaced with null)
    const rows = await orm.sql.unsafe("PRAGMA table_info('test')");
    expect(hasColumn(rows, "data")).toBe(true);

    await orm.close();
  });

  test("createIndex omits IF NOT EXISTS for MySQL", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "mysql");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
      t.string("email");
    });

    await schema.createIndex("users", ["email"], { name: "idx_email" });

    // Verify index exists
    const indexes = await orm.sql.unsafe("PRAGMA index_list('users')");
    expect(hasColumn(indexes, "idx_email")).toBe(true);

    // Without IF NOT EXISTS, creating the same index twice should fail
    const [error] = await schema.createIndex("users", ["email"], {
      name: "idx_email",
    });

    expect(error).not.toBeNull();

    await orm.close();
  });

  test("createTable with FK column creates REFERENCES constraint", async () => {
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

    await schema.createTable("posts", (t) => {
      t.number("id").primaryKey();
      t.number("author_id")
        .notNull()
        .references("users", "id")
        .onDelete("cascade");
    });

    expect(await tableExists(orm, "posts")).toBe(true);

    const info = await orm.sql.unsafe("PRAGMA foreign_key_list('posts')");
    expect(Array.isArray(info)).toBe(true);
    const fk = (info as Record<string, unknown>[]).find(
      (row) => row.table === "users" && row.to === "id",
    );
    expect(fk).toBeDefined();
    expect(fk?.on_delete).toBe("CASCADE");

    await orm.close();
  });

  test("addForeignKey returns error for sqlite", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    const [error] = await schema.addForeignKey(
      "posts",
      "author_id",
      "users",
      "id",
      "cascade",
    );

    expect(error).not.toBeNull();
    expect(error?.message).toContain(
      "addForeignKey is not supported for sqlite",
    );

    await orm.close();
  });

  test("dropForeignKey returns error for sqlite", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    const [error] = await schema.dropForeignKey("posts", "fk_posts_author_id");

    expect(error).not.toBeNull();
    expect(error?.message).toContain(
      "dropForeignKey is not supported for sqlite",
    );

    await orm.close();
  });

  test("ColumnBuilder .references() and .onDelete() chain correctly", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "sqlite");

    await schema.createTable("categories", (t) => {
      t.number("id").primaryKey();
    });

    // onDelete without references should still create the column (FK clause omitted)
    await schema.createTable("items", (t) => {
      t.number("id").primaryKey();
      t.number("category_id")
        .notNull()
        .references("categories", "id")
        .onDelete("restrict");
    });

    expect(await tableExists(orm, "items")).toBe(true);

    const fkList = await orm.sql.unsafe("PRAGMA foreign_key_list('items')");
    expect(Array.isArray(fkList)).toBe(true);
    const fk = (fkList as Record<string, unknown>[]).find(
      (row) => row.table === "categories",
    );
    expect(fk).toBeDefined();
    expect(fk?.on_delete).toBe("RESTRICT");

    await orm.close();
  });

  test("dropIndex throws for MySQL without tableName", async () => {
    const orm = new Orm({
      url: ":memory:",
      dialect: "sqlite",
      tables: {},
    });

    const schema = new SchemaBuilder(orm, "mysql");

    await schema.createTable("users", (t) => {
      t.number("id").primaryKey();
      t.string("email");
    });

    await schema.createIndex("users", ["email"], { name: "idx_email" });

    const [error] = await schema.dropIndex("idx_email"); // Missing tableName

    expect(error).not.toBeNull();
    expect(error?.message).toContain(
      "tableName is required for DROP INDEX on mysql",
    );

    await orm.close();
  });
});
