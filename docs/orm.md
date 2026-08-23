---
title: ORM
description: Typed tables, queries, and SQL migrations on Bun SQL (SQLite or Postgres)
---

Define tables once, then use typed create, find, update, and delete helpers. Semola uses Bun's SQL client and supports SQLite and Postgres.

## Quick start

Use a persistent database URL. Migration commands open their own connection, so `:memory:` does not survive from `create` to `apply`.

### 1. Define a table and client

```typescript
// src/db.ts
import { createOrm, defineTable, string, uuid } from "semola/orm";

export const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
});

export const db = createOrm({
  adapter: "sqlite",
  url: "file:./dev.db",
  tables: { users },
});
```

`defineTable()` describes row types and the database schema. `createOrm()` creates a typed client, but does not create the physical table.

### 2. Initialize the database

```typescript
// semola.config.ts
import { defineConfig } from "semola";

export default defineConfig({
  orm: {
    schema: "./src/db.ts",
  },
});
```

```sh
bunx semola orm migrations create "initialize_database"
bunx semola orm migrations apply
```

Review generated SQL before applying. For later schema changes, edit the table definitions and run both commands again.

### 3. Use the typed client

```typescript
import { db } from "./db.js";

await db.users.create({
  data: {
    id: "u1",
    name: "Ada",
    email: "ada@example.com",
  },
});

const user = await db.users.findFirst({
  where: { email: "ada@example.com" },
});
```

## Tables and columns

Columns start nullable. Chain modifiers to tighten them.

```typescript
const users = defineTable("users", {
  id: uuid("id").primaryKey().default(() => crypto.randomUUID()),
  email: string("email").notNull().unique(),
  role: string("role").notNull().dbDefault("member"),
  createdAt: date("created_at")
    .notNull()
    .dbDefault("CURRENT_TIMESTAMP", { as: "sql" }),
});
```

### Types

| Builder | JS type |
| --- | --- |
| `string` | `string` |
| `number` | `number` |
| `boolean` | `boolean` |
| `uuid` | `string` |
| `date` | `Date` |
| `json`, `jsonb` | `unknown` (pass a generic to narrow) |
| `enumType` | union of the listed strings |

### Modifiers

| Method | Meaning |
| --- | --- |
| `.primaryKey()` | Primary key (also not-null) |
| `.notNull()` | Required |
| `.nullable()` | Optional |
| `.unique()` | Unique constraint |
| `.default(fn)` | App fills the value on `create()` |
| `.dbDefault(value)` | SQL literal default (`"user"`, `0`, `true`) |
| `.dbDefault(sql, { as: "sql" })` | Raw SQL default (`now()`, `gen_random_uuid()`) |
| `.references(() => col)` | Foreign key |

`.references()` targets must be tables passed to `createOrm({ tables })`.

| | `.default(fn)` | `.dbDefault(...)` |
| --- | --- | --- |
| Who fills it | App, on `create()` | Database |
| Omitted insert | Runs `fn` | Uses the SQL default (not `null`) |

Use `.dbDefault()` when adding a `NOT NULL` column. `{ as: "sql" }` is for SQL expressions such as functions and `CURRENT_TIMESTAMP` (a single expression only).

### Relations

```typescript
const posts = defineTable("posts", {
  id: uuid("id").primaryKey().notNull(),
  title: string("title").notNull(),
  authorId: uuid("authorId")
    .notNull()
    .references(() => users.columns.id),
});

const db = createOrm({
  adapter: "sqlite",
  url: "file:./dev.db",
  tables: { users, posts },
  relations: {
    users: {
      posts: many(() => posts),
    },
    posts: {
      author: one("authorId", () => users),
    },
  },
});
```

`one(foreignKeyColumn, () => table)` uses the source table's FK column name. `many(() => table)` is the reverse side.

## Queries

```typescript
await db.users.create({
  data: {
    id: "u1",
    name: "Ada",
    email: "ada@example.com",
  },
});

const user = await db.users.findFirst({
  where: { email: "ada@example.com" },
});

const page = await db.posts.findMany({
  where: { authorId: "u1" },
  orderBy: { title: "asc" },
  take: 20,
  skip: 0,
  include: { author: true },
});

await db.users.update({
  where: { id: "u1" },
  data: { name: "Augusta" },
});

await db.posts.deleteMany({
  where: { authorId: "u1" },
});
```

| Option | Meaning |
| --- | --- |
| `where` | Column operators, plus `$and` / `$or` / `$not`. Relations: `every` / `some` / `none` |
| `select` | Fields to return |
| `include` | Related rows |
| `$skipHooks` | Skip hooks for this call |

| Method | Meaning |
| --- | --- |
| `findMany` / `findFirst` / `findUnique` | Read |
| `create` / `createMany` | Insert |
| `update` / `updateMany` | Patch |
| `delete` / `deleteMany` | Remove |

## Transactions and raw SQL

```typescript
await db.$transaction(async (tx) => {
  await tx.users.create({ data: { /* ... */ } });
  await tx.posts.create({ data: { /* ... */ } });
});

await db.$raw.unsafe(`SELECT 1`);
```

`$raw` is the underlying `Bun.SQL` instance. Prefer migrations for schema changes.

## Hooks

Before-hooks may return patched options. After-hooks and read hooks receive context only. Column-specific work belongs on `hooks.tables.<name>`.

```typescript
const db = createOrm({
  adapter: "sqlite",
  url: "file:./dev.db",
  tables: { users },
  hooks: {
    tables: {
      users: {
        beforeCreate(ctx) {
          return {
            data: {
              ...ctx.options.data,
              name: ctx.options.data.name.trim(),
            },
          };
        },
        afterCreate(ctx) {
          if (ctx.result) {
            console.log("created", ctx.result.id);
          }
        },
      },
    },
  },
});
```

## Migrations

`createOrm()` never changes the physical database schema. Use the CLI to generate and apply SQL from your table definitions.

### Configuration

```typescript
import { defineConfig } from "semola";

export default defineConfig({
  orm: {
    schema: "./src/db.ts",
    migrationsDir: "migrations", // optional, default "migrations"
  },
});
```

`schema` must export a `createOrm()` client (default or named). Run commands from the directory that contains `semola.config.ts`.

### Commands

```sh
bunx semola orm migrations create "add_user_roles"
bunx semola orm migrations apply
bunx semola orm migrations rollback
```

- Apply pending migrations before creating another one.
- `create` fails when nothing changed.
- Review `up.sql` / `down.sql` before `apply`, especially drop and `NOT NULL` warnings.
- Ambiguous drop+add asks whether it is a rename or create-from-scratch (TTY). Non-TTY create fails on ambiguous renames.
- Destructive drops ask for confirmation (TTY) or `--allow-destructive`.
- Rollback rejects an empty or comment-only `down.sql`.
- Do not hand-edit applied migration files; keep folders in order. Apply stores an `up.sql` checksum and rejects drift.

Each migration folder looks like:

```text
migrations/
  20260817090000000_add_user_roles/
    up.sql
    down.sql
    schema.json
```

Not generated in v1: secondary indexes, foreign-key `ON DELETE` / `ON UPDATE` actions, or custom Postgres `USING` expressions.

## Examples

### Find with include

```typescript
const post = await db.posts.findFirst({
  where: { id: "p1" },
  include: { author: true },
});

console.log(post?.author?.email);
```

### Compound where

```typescript
const active = await db.users.findMany({
  where: {
    $and: [{ name: { startsWith: "A" } }, { email: { contains: "@" } }],
  },
  orderBy: { name: "asc" },
  take: 10,
});
```

### Transaction rollback

Throwing inside `$transaction()` rolls back every write made through the transaction client.

```typescript
await db.$transaction(async (tx) => {
  await tx.users.create({
    data: { id: "u2", name: "Grace", email: "grace@example.com" },
  });

  throw new Error("abort");
});
```

## Reference

### `createOrm` options

| Option | Meaning |
| --- | --- |
| `adapter` | `"sqlite"` or `"postgres"` |
| `url` | Connection URL (e.g. `"file:./dev.db"`) |
| `tables` | Map of `defineTable` results |
| `relations` | Optional `one` / `many` map |
| `hooks` | Global and per-table lifecycle hooks |

### Client

| Member | Meaning |
| --- | --- |
| `db.<table>` | Typed table client |
| `db.$raw` | Underlying `Bun.SQL` |
| `db.$transaction(cb)` | Run work in a transaction |
| `db.$config` | Adapter, redacted URL, and tables |
