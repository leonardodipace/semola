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

Point Semola's CLI at the module that exports your ORM client:

```typescript
// semola.config.ts
import { defineConfig } from "semola";

export default defineConfig({
  orm: {
    schema: "./src/db.ts",
  },
});
```

Create SQL from the table definition, review it, then apply it:

```sh
bunx semola orm migrations create "initialize_database"
bunx semola orm migrations apply
```

For later schema changes, edit the table definitions and run both commands again. See [Migrations](#migrations) for defaults, rollbacks, and generated SQL behavior.

### 3. Use the typed client

After migrations are applied, import the client anywhere in your app:

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

TypeScript infers the accepted data, filters, and returned row from the table definition.

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

`.references()` targets must be tables passed to `createOrm({ tables })`. Invalid keys fail when you generate a migration.

| | `.default(fn)` | `.dbDefault(...)` |
| --- | --- | --- |
| Who fills it | App, on `create()` | Database |
| Omitted insert | Runs `fn` | Uses the SQL default (not `null`) |

Use `.dbDefault()` when adding a `NOT NULL` column. `{ as: "sql" }` is for trusted SQL such as functions, casts, and `CURRENT_TIMESTAMP`.

### Relations

The relation map links each post to one author and each user to many posts through `authorId`.

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

`one(foreignKeyColumn, () => table)` uses the **source** table's FK column name. `many(() => table)` is the reverse side.

## Queries

### CRUD

These calls show create, single and list queries, update, and bulk delete on typed table clients.

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

### Filters and shaping

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

The transaction commits both inserts together or rolls both back when the callback throws. `$raw` runs SQL directly.

```typescript
await db.$transaction(async (tx) => {
  await tx.users.create({ data: { /* ... */ } });
  await tx.posts.create({ data: { /* ... */ } });
});

await db.$raw.unsafe(`SELECT 1`);
```

`$raw` is the underlying `Bun.SQL` instance. Inside a transaction, `tx` exposes the same table clients plus `$raw`.

## Hooks

Before-hooks receive a context and may return patched options. After-hooks and read hooks receive context only.

The table hook trims user names before insert, then logs the created row. Global hooks are generic over every table, so column-specific work belongs on `hooks.tables.<name>`.

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

`createOrm()` never changes the physical database schema. Semola migrations compare your table definitions with the last applied schema and generate SQL for your configured adapter.

### Configuration

The root `semola.config.ts` file needs:

- `schema`: path to a module that exports a `createOrm()` client, either as a default or named export
- `migrationsDir`: optional output directory, relative to the project root; defaults to `migrations`

```typescript
import { defineConfig } from "semola";

export default defineConfig({
  orm: {
    schema: "./src/db.ts",
    migrationsDir: "migrations",
  },
});
```

The CLI reads the client's adapter, URL, and tables. Run migration commands from the directory containing `semola.config.ts`.

### Commands

```sh
# Generate up.sql and down.sql from table changes
bunx semola orm migrations create "add_user_roles"

# Apply every pending migration in order
bunx semola orm migrations apply

# Roll back only the latest applied migration
bunx semola orm migrations rollback
```

Apply pending migrations before creating another one. `create` fails when there are no schema changes. The first `create` or `apply` also ensures the `_semola_migrations` history table exists.

Each generated migration has this layout:

```text
migrations/
  20260817090000000_add_user_roles/
    up.sql
    down.sql
```

Review generated SQL before applying it, especially warnings about destructive changes. Each pending migration commits in its own transaction.

### History and safety

Semola stores applied migration names and schema snapshots in the `_semola_migrations` database table. Migration directories must remain an exact ordered prefix of that history. Missing, reordered, or extra applied entries fail before new SQL runs.

Every generated `up.sql` contains a `-- semola-schema:` header. Keep it intact: `apply` uses it as the next schema snapshot and rejects migrations without it.

SQLite has additional safeguards:

- Foreign keys are enabled on the first ORM query.
- Safe column additions and drops run in place. Unsupported alterations rebuild the table and copy shared columns so existing rows survive.
- A rename is generated as a drop and add, with a warning in the SQL.
- A down migration that restores a `NOT NULL` column without a default warns and fails when rows exist.
- Apply and rollback run `PRAGMA foreign_key_check` before commit.

Generated column types differ between SQLite and Postgres. Migration apply and rollback are integration-tested on SQLite today.

### Apply from application code

Run migrations in a dedicated startup step, not from the same module you import as `db`:

```typescript
import { applyMigrations, loadConfig } from "semola/orm";

const config = await loadConfig();
await applyMigrations(config);
```

`loadConfig()` imports your schema module and closes its ORM client after reading `$config`. If that module is also your app's `db` export, the shared client can be left closed. Prefer the CLI, or keep migrations in a separate entry file.

## Examples

### Create one row

`create()` inserts one typed row and returns it.

```typescript
const user = await db.users.create({
  data: { id: "u1", name: "Ada", email: "ada@example.com" },
});
```

### Find with include

`findFirst()` returns the first matching post and loads its related author.

```typescript
const post = await db.posts.findFirst({
  where: { id: "p1" },
  include: { author: true },
});

console.log(post?.author?.email);
```

### Compound where

`findMany()` combines filters, sorts matches, and limits the result to ten rows.

```typescript
const active = await db.users.findMany({
  where: {
    $and: [{ name: { startsWith: "A" } }, { email: { contains: "@" } }],
  },
  orderBy: { name: "asc" },
  take: 10,
});
```

### Find a unique row

`findUnique()` expects a unique filter and returns that row or `null`.

```typescript
const user = await db.users.findUnique({
  where: { id: "u1" },
});
```

### Create many rows

`createMany()` inserts all supplied rows in one operation.

```typescript
await db.users.createMany({
  data: [
    { id: "u2", name: "Grace", email: "grace@example.com" },
    { id: "u3", name: "Linus", email: "linus@example.com" },
  ],
});
```

### Update many rows

`updateMany()` applies the same patch to every row matching the filter.

```typescript
await db.users.updateMany({
  where: { name: { startsWith: "A" } },
  data: { name: "Anonymous" },
});
```

### Update one row

`update()` patches the row selected by a unique filter and returns the updated value.

```typescript
const user = await db.users.update({
  where: { id: "u1" },
  data: { name: "Augusta" },
});
```

### Delete one row

`delete()` removes the row selected by a unique filter.

```typescript
await db.users.delete({
  where: { id: "u3" },
});
```

### Delete many rows

`deleteMany()` removes every matching row and returns the affected rows.

```typescript
const deleted = await db.posts.deleteMany({
  where: { authorId: "u1" },
});
```

### Transaction rollback

Throwing inside `$transaction()` rolls back every write made through the transaction client.

```typescript
await db.$transaction(async (tx) => {
  await tx.users.create({
    data: { id: "u2", name: "Grace", email: "grace@example.com" },
  });

  // throw to roll back
  throw new Error("abort");
});
```

### Schema via `$raw`

`$raw` exposes Bun's SQL client for ad-hoc SQL. Prefer `bunx semola orm migrations` for schema changes.

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
| `db.$config` | Adapter, redacted URL, and tables (used by migrations) |

### Migration helpers

| Export | Meaning |
| --- | --- |
| `loadConfig()` | Load `semola.config.ts` and resolve the ORM client |
| `createMigration({ name, config })` | Generate `up.sql` / `down.sql` from schema diff |
| `applyMigrations(config)` | Apply pending migrations |
| `rollbackMigration(config)` | Roll back the latest migration |
