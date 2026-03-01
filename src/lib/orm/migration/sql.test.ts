import { describe, expect, test } from "bun:test";
import { buildDownSql, buildUpSql } from "./sql.js";
import type { MigrationOperation } from "./types.js";

const operations: MigrationOperation[] = [
  {
    kind: "create-table",
    table: {
      key: "users",
      tableName: "users",
      columns: {
        id: {
          key: "id",
          sqlName: "id",
          kind: "uuid",
          isPrimaryKey: true,
          isNotNull: true,
          isUnique: false,
          hasDefault: false,
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    },
  },
];

describe("buildUpSql/buildDownSql", () => {
  test("emits postgres create/drop statements", () => {
    const up = buildUpSql("postgres", operations);
    const down = buildDownSql("postgres", operations);

    expect(up).toContain('CREATE TABLE "users"');
    expect(up).toContain("DEFAULT gen_random_uuid()");
    expect(down).toContain('DROP TABLE "users"');
  });

  test("emits mysql quoting", () => {
    const up = buildUpSql("mysql", operations);
    expect(up).toContain("CREATE TABLE `users`");
  });

  test("maps jsonb by dialect", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "create-table",
        table: {
          key: "events",
          tableName: "events",
          columns: {
            payload: {
              key: "payload",
              sqlName: "payload",
              kind: "jsonb",
              isPrimaryKey: false,
              isNotNull: true,
              isUnique: false,
              hasDefault: false,
              referencesTable: null,
              referencesColumn: null,
              onDeleteAction: null,
            },
          },
        },
      },
    ];

    expect(buildUpSql("postgres", ops)).toContain('"payload" JSONB');
    expect(buildUpSql("mysql", ops)).toContain("`payload` JSON");
    expect(buildUpSql("sqlite", ops)).toContain('"payload" TEXT');
  });

  test("emits literal DEFAULT for added json column", () => {
    const ops: MigrationOperation[] = [
      {
        kind: "add-column",
        tableName: "users",
        column: {
          key: "meta",
          sqlName: "meta",
          kind: "json",
          isPrimaryKey: false,
          isNotNull: true,
          isUnique: false,
          hasDefault: true,
          defaultKind: "value",
          defaultValue: { level: 0 },
          referencesTable: null,
          referencesColumn: null,
          onDeleteAction: null,
        },
      },
    ];

    const up = buildUpSql("postgres", ops);
    expect(up).toContain(
      `ALTER TABLE "users" ADD COLUMN "meta" JSON NOT NULL DEFAULT '{"level":0}'`,
    );
  });
});
