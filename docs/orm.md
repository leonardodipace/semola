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

This defines a typed table, opens an in-memory SQLite client, inserts one user, then finds it by email.

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

`where` supports column operators and `$and` / `$or` / `$not`. Relation filters use `every` / `some` / `none`. Pass `select` to shape returned fields. `$skipHooks` bypasses hooks for that call.

Table methods: `findMany`, `findFirst`, `findUnique`, `create`, `createMany`, `update`, `updateMany`, `delete`, `deleteMany`.

## Transactions and raw SQL

The transaction commits both inserts together or rolls both back when the callback throws. `$raw` runs SQL directly.

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

The global hook trims user names before insert, then the table hook logs the created row.

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

console.log(post?.author.email);
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

`$raw` exposes Bun's SQL client for schema operations or queries outside the typed table API.

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
