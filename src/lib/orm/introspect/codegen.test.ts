import { describe, expect, test } from "bun:test";
import { generateCode } from "./codegen.js";
import type { IntrospectedTable } from "./types.js";

const usersTable: IntrospectedTable = {
  name: "users",
  columns: [
    {
      sqlName: "id",
      kind: "uuid",
      nullable: false,
      primaryKey: true,
      unique: false,
      rawDefault: null,
      references: null,
      unknownDbType: null,
    },
    {
      sqlName: "email",
      kind: "string",
      nullable: false,
      primaryKey: false,
      unique: true,
      rawDefault: null,
      references: null,
      unknownDbType: null,
    },
    {
      sqlName: "created_at",
      kind: "date",
      nullable: true,
      primaryKey: false,
      unique: false,
      rawDefault: "now()",
      references: null,
      unknownDbType: null,
    },
  ],
};

const postsTable: IntrospectedTable = {
  name: "posts",
  columns: [
    {
      sqlName: "id",
      kind: "uuid",
      nullable: false,
      primaryKey: true,
      unique: false,
      rawDefault: null,
      references: null,
      unknownDbType: null,
    },
    {
      sqlName: "user_id",
      kind: "uuid",
      nullable: false,
      primaryKey: false,
      unique: false,
      rawDefault: null,
      references: { table: "users", column: "id", onDelete: "CASCADE" },
      unknownDbType: null,
    },
  ],
};

describe("generateCode", () => {
  test("emits correct imports", () => {
    const code = generateCode([usersTable], "postgres");

    expect(code).toContain(
      'import { createOrm, createTable, date, string, uuid } from "semola/orm"',
    );
    expect(code).not.toContain('from "bun"');
  });

  test("emits createTable calls", () => {
    const code = generateCode([usersTable], "postgres");

    expect(code).toContain('const usersTable = createTable("users", {');
    expect(code).toContain('id: uuid("id").primaryKey().notNull(),');
    expect(code).toContain('email: string("email").notNull().unique(),');
  });

  test("converts snake_case to camelCase for JS keys", () => {
    const code = generateCode([usersTable], "postgres");

    expect(code).toContain('createdAt: date("created_at")');
  });

  test("does not emit .sqlName() chain calls", () => {
    const code = generateCode([usersTable], "postgres");

    expect(code).not.toContain(".sqlName(");
  });

  test("emits nullable column without notNull()", () => {
    const code = generateCode([usersTable], "postgres");

    expect(code).toContain('createdAt: date("created_at")');
    const createdAtLine = code
      .split("\n")
      .find((l) => l.includes("createdAt:"));
    expect(createdAtLine).not.toContain("notNull()");
  });

  test("emits onDelete for foreign key columns", () => {
    const code = generateCode([postsTable], "postgres");

    expect(code).toContain('.onDelete("CASCADE")');
  });

  test("emits createOrm with correct dialect and tables", () => {
    const code = generateCode([usersTable, postsTable], "postgres");

    expect(code).toContain("export const orm = createOrm({");
    expect(code).toContain('url: process.env.DATABASE_URL ?? "",');
    expect(code).toContain('dialect: "postgres"');
    expect(code).toContain("users: usersTable,");
    expect(code).toContain("posts: postsTable,");
  });

  test("emits TODO comment for unknown DB types", () => {
    const tableWithUnknown: IntrospectedTable = {
      name: "things",
      columns: [
        {
          sqlName: "data",
          kind: "string",
          nullable: true,
          primaryKey: false,
          unique: false,
          rawDefault: null,
          references: null,
          unknownDbType: "bytea",
        },
      ],
    };

    const code = generateCode([tableWithUnknown], "postgres");

    expect(code).toContain(
      'data: string("data"), // TODO: unknown type: bytea',
    );
  });

  test("handles tables with multi-word names via camelCase", () => {
    const table: IntrospectedTable = {
      name: "user_profiles",
      columns: [
        {
          sqlName: "id",
          kind: "uuid",
          nullable: false,
          primaryKey: true,
          unique: false,
          rawDefault: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain("const userProfilesTable = createTable(");
    expect(code).toContain("userProfiles: userProfilesTable,");
  });
});
