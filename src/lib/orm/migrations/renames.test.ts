import { describe, expect, test } from "bun:test";
import { string, uuid } from "../column/index.js";
import { defineTable } from "../table/index.js";
import { diffSchemas } from "./diff.js";
import { resolveRenames, reverseRenameOps } from "./renames.js";
import { emptySchema, snapshotSchema } from "./snapshot.js";
import { renderMigrationSql } from "./sql.js";

describe("orm migration renames", () => {
  test("maps a table rename and emits ALTER TABLE RENAME", async () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
    });
    const from = snapshotSchema({ users });
    const to = snapshotSchema({ people });
    const renamed = await resolveRenames(from, to, () => "users");
    const sql = renderMigrationSql("sqlite", [
      ...renamed.ops,
      ...diffSchemas(renamed.from, to, "sqlite"),
    ]);

    expect(renamed.ops).toEqual([
      { kind: "renameTable", from: "users", to: "people" },
    ]);
    expect(sql).toContain('ALTER TABLE "users" RENAME TO "people"');
    expect(sql).not.toContain("DROP TABLE");
  });

  test("maps a column rename and emits RENAME COLUMN", async () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      bio: string("bio"),
    });
    const after = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      about: string("about"),
    });
    const from = snapshotSchema({ users: before });
    const to = snapshotSchema({ users: after });
    const renamed = await resolveRenames(from, to, () => "bio");
    const sql = renderMigrationSql("postgres", [
      ...renamed.ops,
      ...diffSchemas(renamed.from, to, "postgres"),
    ]);

    expect(renamed.ops).toEqual([
      { kind: "renameColumn", table: "users", from: "bio", to: "about" },
    ]);
    expect(sql).toContain('ALTER TABLE "users" RENAME COLUMN "bio" TO "about"');
  });

  test("throws without onRename when drop and create overlap", async () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
    });

    await expect(
      resolveRenames(snapshotSchema({ users }), snapshotSchema({ people })),
    ).rejects.toThrow("Possible table rename");
  });

  test("create-new leaves drop and create ops", async () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const people = defineTable("people", {
      id: uuid("id").primaryKey().notNull(),
    });
    const from = snapshotSchema({ users });
    const to = snapshotSchema({ people });
    const renamed = await resolveRenames(from, to, () => undefined);
    const ops = [...renamed.ops, ...diffSchemas(renamed.from, to, "sqlite")];

    expect(renamed.ops).toEqual([]);
    expect(ops.map((op) => op.kind).sort()).toEqual([
      "createTable",
      "dropTable",
    ]);
  });

  test("reverseRenameOps reverses rename order", () => {
    expect(
      reverseRenameOps([
        { kind: "renameTable", from: "users", to: "people" },
        { kind: "renameColumn", table: "people", from: "bio", to: "about" },
      ]),
    ).toEqual([
      { kind: "renameColumn", table: "people", from: "about", to: "bio" },
      { kind: "renameTable", from: "people", to: "users" },
    ]);
  });

  test("does nothing when schemas only add a table", async () => {
    const users = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
    });
    const renamed = await resolveRenames(
      emptySchema(),
      snapshotSchema({ users }),
    );

    expect(renamed.ops).toEqual([]);
  });
});
