import { describe, expect, test } from "bun:test";
import { generateCode } from "./codegen.js";
import type { IntrospectedTable } from "./types.js";

const usersTable: IntrospectedTable = {
  name: "users",
  columns: [
    {
      sqlName: "id",
      kind: "uuid",
      enumValues: null,
      nullable: false,
      primaryKey: true,
      unique: false,
      rawDefault: null,
      arrayElementKind: null,
      references: null,
      unknownDbType: null,
    },
    {
      sqlName: "email",
      kind: "string",
      enumValues: null,
      nullable: false,
      primaryKey: false,
      unique: true,
      rawDefault: null,
      arrayElementKind: null,
      references: null,
      unknownDbType: null,
    },
    {
      sqlName: "created_at",
      kind: "date",
      enumValues: null,
      nullable: true,
      primaryKey: false,
      unique: false,
      rawDefault: "now()",
      arrayElementKind: null,
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
      enumValues: null,
      nullable: false,
      primaryKey: true,
      unique: false,
      rawDefault: null,
      arrayElementKind: null,
      references: null,
      unknownDbType: null,
    },
    {
      sqlName: "user_id",
      kind: "uuid",
      enumValues: null,
      nullable: false,
      primaryKey: false,
      unique: false,
      rawDefault: null,
      arrayElementKind: null,
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
    expect(code).toContain('id: uuid("id").primaryKey(),');
    expect(code).toContain('email: string("email").notNull().unique(),');
  });

  test("emits default chains when raw defaults are recognized", () => {
    const code = generateCode([usersTable], "postgres");

    expect(code).toContain(
      'createdAt: date("created_at").defaultFn(() => new Date()),',
    );
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

  test("emits one() and many() relations in createOrm", () => {
    const code = generateCode([usersTable, postsTable], "postgres");

    expect(code).toContain("many, one");
    expect(code).toContain("relations: {");
    expect(code).toContain("users: {");
    expect(code).toContain('posts: many(() => postsTable, "user_id"),');
    expect(code).toContain("posts: {");
    expect(code).toContain('user: one("user_id", () => usersTable),');
  });

  test("emits unique many() relation keys for repeated foreign keys", () => {
    const commentsTable: IntrospectedTable = {
      name: "comments",
      columns: [
        {
          sqlName: "id",
          kind: "uuid",
          nullable: false,
          primaryKey: true,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
        {
          sqlName: "author_id",
          kind: "uuid",
          nullable: false,
          primaryKey: false,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: { table: "users", column: "id", onDelete: null },
          unknownDbType: null,
        },
        {
          sqlName: "reviewer_id",
          kind: "uuid",
          nullable: false,
          primaryKey: false,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: { table: "users", column: "id", onDelete: null },
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([usersTable, commentsTable], "postgres");

    expect(code).toContain('comments: many(() => commentsTable, "author_id"),');
    expect(code).toContain(
      'commentsByReviewerId: many(() => commentsTable, "reviewer_id"),',
    );
    expect(code).toContain('author: one("author_id", () => usersTable),');
    expect(code).toContain('reviewer: one("reviewer_id", () => usersTable),');
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
          arrayElementKind: null,
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
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain("const userProfilesTable = createTable(");
    expect(code).toContain("userProfiles: userProfilesTable,");
  });

  test("maps uuid primary key DB defaults to defaultFn", () => {
    const tableWithUuidDefault: IntrospectedTable = {
      name: "users",
      columns: [
        {
          sqlName: "id",
          kind: "uuid",
          nullable: false,
          primaryKey: true,
          unique: false,
          rawDefault: "gen_random_uuid()",
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([tableWithUuidDefault], "postgres");

    expect(code).toContain(
      'id: uuid("id").primaryKey().defaultFn(() => crypto.randomUUID()),',
    );
    expect(code).not.toContain('id: uuid("id").primaryKey().notNull(),');
  });

  test("maps postgres arrays to typed json array columns", () => {
    const tableWithArray: IntrospectedTable = {
      name: "organizations",
      columns: [
        {
          sqlName: "auth_methods",
          kind: "string",
          enumValues: ["basic", "microsoft", "cognito", "okta"],
          nullable: true,
          primaryKey: false,
          unique: false,
          rawDefault: "ARRAY['basic']::auth_method[]",
          arrayElementKind: "string",
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([tableWithArray], "postgres");

    expect(code).toContain(
      'authMethods: enumeration("auth_methods", ["basic", "microsoft", "cognito", "okta"]).asArray().default(["basic"]),',
    );
  });

  test("parses array default with per-element cast (PostgreSQL canonical form)", () => {
    const table: IntrospectedTable = {
      name: "organizations",
      columns: [
        {
          sqlName: "auth_methods",
          kind: "string",
          enumValues: ["basic", "microsoft"],
          nullable: true,
          primaryKey: false,
          unique: false,
          rawDefault: "ARRAY['basic'::auth_method]",
          arrayElementKind: "string",
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain(
      'authMethods: enumeration("auth_methods", ["basic", "microsoft"]).asArray().default(["basic"]),',
    );
  });

  test("emits jsonb column correctly", () => {
    const table: IntrospectedTable = {
      name: "computer_actions",
      columns: [
        {
          sqlName: "configuration",
          kind: "jsonb",
          nullable: false,
          primaryKey: false,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain('configuration: jsonb("configuration").notNull(),');
    expect(code).toContain("jsonb");
  });

  test("handles underscore-prefixed table names (Prisma join tables)", () => {
    const table: IntrospectedTable = {
      name: "_RoleToUser",
      columns: [
        {
          sqlName: "A",
          kind: "string",
          nullable: false,
          primaryKey: true,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
        {
          sqlName: "B",
          kind: "string",
          nullable: false,
          primaryKey: true,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain(
      'const _RoleToUserTable = createTable("_RoleToUser", {',
    );
    expect(code).toContain('A: string("A").primaryKey(),');
    expect(code).toContain('B: string("B").primaryKey(),');
    expect(code).toContain("_RoleToUser: _RoleToUserTable,");
  });

  test("emits array column with notNull when not nullable and no default", () => {
    const table: IntrospectedTable = {
      name: "schedules",
      columns: [
        {
          sqlName: "rule",
          kind: "string",
          nullable: false,
          primaryKey: false,
          unique: false,
          rawDefault: null,
          arrayElementKind: "string",
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain('rule: string("rule").asArray().notNull(),');
  });

  test("parses enum column default with type cast suffix", () => {
    const table: IntrospectedTable = {
      name: "sites",
      columns: [
        {
          sqlName: "status",
          kind: "string",
          enumValues: ["active", "retired"],
          nullable: false,
          primaryKey: false,
          unique: false,
          rawDefault: "'active'::site_status",
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain(
      'status: enumeration("status", ["active", "retired"]).default("active").notNull(),',
    );
  });

  test("emits enumeration import when enum columns exist", () => {
    const table: IntrospectedTable = {
      name: "sites",
      columns: [
        {
          sqlName: "status",
          kind: "string",
          enumValues: ["active", "retired"],
          nullable: false,
          primaryKey: false,
          unique: false,
          rawDefault: null,
          arrayElementKind: null,
          references: null,
          unknownDbType: null,
        },
      ],
    };

    const code = generateCode([table], "postgres");

    expect(code).toContain("enumeration");
  });
});
