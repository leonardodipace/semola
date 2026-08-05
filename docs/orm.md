---
title: ORM
description: Typed tables and queries on Bun SQL (SQLite or Postgres)
---

Define tables once, get typed create / find / update / delete helpers. Uses Bun's SQL client under the hood.

You still create the physical schema yourself (migrations / `$raw`). The ORM does not auto-migrate.

## Import

```typescript
import {
  createOrm,
  defineTable,
  string,
  uuid,
  number,
  boolean,
  one,
  many,
} from "semola/orm";
```

## Quick start

```typescript
const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").notNull().unique(),
});

const db = createOrm({
  adapter: "sqlite", // or "postgres"
  url: ":memory:",
  tables: { users },
});

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

### Column builders

`string`, `number`, `boolean`, `uuid`, `date`, `json`, `jsonb`, `enumType`.

Chain `.primaryKey()`, `.notNull()`, `.nullable()`, `.unique()`, `.default(fn)`, `.references(() => other.columns.col)`. Columns start nullable until you mark otherwise.

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
  url: ":memory:",
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

`where` supports column operators and `$and` / `$or` / `$not`. Relation filters use `every` / `some` / `none`. Pass `select` to shape returned fields. `$skipHooks` bypasses hooks for that call.

Table methods: `findMany`, `findFirst`, `findUnique`, `create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`.

## Transactions and raw SQL

```typescript
await db.$transaction(async (tx) => {
  await tx.users.create({ data: { /* ... */ } });
  await tx.posts.create({ data: { /* ... */ } });
});

await db.$raw.unsafe(`CREATE TABLE IF NOT EXISTS users (...)`);
```

`$raw` is the underlying `Bun.SQL` instance. Inside a transaction, `tx` exposes the same table clients plus `$raw`.

## Hooks

Hooks receive a context and may return patched options:

```typescript
const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
  hooks: {
    beforeCreate(ctx) {
      return {
        data: {
          ...ctx.options.data,
          name: ctx.options.data.name.trim(),
        },
      };
    },
    tables: {
      users: {
        afterCreate(ctx) {
          console.log("created", ctx.result.id);
        },
      },
    },
  },
});
```

## Examples

### Example: Find with include

```typescript
const post = await db.posts.findFirst({
  where: { id: "p1" },
  include: { author: true },
});

console.log(post?.author.email);
```

### Example: Compound where

```typescript
const active = await db.users.findMany({
  where: {
    $and: [{ name: { startsWith: "A" } }, { email: { contains: "@" } }],
  },
  orderBy: { name: "asc" },
  take: 10,
});
```

### Example: Transaction rollback

```typescript
await db.$transaction(async (tx) => {
  await tx.users.create({
    data: { id: "u2", name: "Grace", email: "grace@example.com" },
  });

  // throw to roll back
  throw new Error("abort");
});
```

### Example: Schema via `$raw`

```typescript
await db.$raw.unsafe(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  )
`);
```

## Reference

### `createOrm` options

| Option | Meaning |
| --- | --- |
| `adapter` | `"sqlite"` or `"postgres"` |
| `url` | Connection URL (e.g. `":memory:"`) |
| `tables` | Map of `defineTable` results |
| `relations` | Optional `one` / `many` map |
| `hooks` | Global and per-table lifecycle hooks |

### Client

| Member | Meaning |
| --- | --- |
| `db.<table>` | Typed table client |
| `db.$raw` | Underlying `Bun.SQL` |
| `db.$transaction(cb)` | Run work in a transaction |
