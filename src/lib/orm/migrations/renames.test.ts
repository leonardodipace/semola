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
      {
        kind: "renameTable",
        from: "users",
        to: "people",
        constraints: [{ from: "users_pkey", to: "people_pkey" }],
      },
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
      {
        kind: "renameColumn",
        table: "users",
        from: "bio",
        to: "about",
        constraints: [],
      },
    ]);
    expect(sql).toContain('ALTER TABLE "users" RENAME COLUMN "bio" TO "about"');
  });

  test("postgres renames constraints with table and column renames", async () => {
    const before = defineTable("users", {
      id: uuid("id").primaryKey().notNull(),
      email: string("email").notNull().unique(),
    });
    const after = defineTable("accounts", {
      id: uuid("id").primaryKey().notNull(),
      emailAddress: string("emailAddress").notNull().unique(),
    });
    const from = snapshotSchema({ users: before });
    const to = snapshotSchema({ accounts: after });
    const renamed = await resolveRenames(from, to, (question) => {
      if (question.kind === "table") return "users";

      return "email";
    });
    const sql = renderMigrationSql("postgres", [
      ...renamed.ops,
      ...diffSchemas(renamed.from, to, "postgres"),
    ]);

    expect(sql).toContain(
      'ALTER TABLE "accounts" RENAME CONSTRAINT "users_pkey" TO "accounts_pkey"',
    );
    expect(sql).toContain(
      'ALTER TABLE "accounts" RENAME CONSTRAINT "users_email_key" TO "accounts_email_key"',
    );
    expect(sql).toContain(
      'ALTER TABLE "accounts" RENAME CONSTRAINT "accounts_email_key" TO "accounts_emailAddress_key"',
    );
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
        {
          kind: "renameTable",
          from: "users",
          to: "people",
          constraints: [{ from: "users_pkey", to: "people_pkey" }],
        },
        {
          kind: "renameColumn",
          table: "people",
          from: "bio",
          to: "about",
          constraints: [{ from: "people_bio_key", to: "people_about_key" }],
        },
      ]),
    ).toEqual([
      {
        kind: "renameColumn",
        table: "people",
        from: "about",
        to: "bio",
        constraints: [{ from: "people_about_key", to: "people_bio_key" }],
      },
      {
        kind: "renameTable",
        from: "people",
        to: "users",
        constraints: [{ from: "people_pkey", to: "users_pkey" }],
      },
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
