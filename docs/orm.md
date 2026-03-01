# ORM

Semola ORM is a type-safe data layer for Bun that combines expressive query APIs, result-pattern ergonomics, and built-in migration tooling.

It provides:

- Strong TypeScript inference from table definitions
- Result-pattern CRUD methods (`[error, data]`)
- SQL-style methods that map directly to Bun SQL execution
- Lightweight relations via `include` joins
- File-based migration workflow + CLI

## Import

```typescript
import {
  createOrm,
  createTable,
  string,
  number,
  boolean,
  date,
  json,
  jsonb,
  uuid,
  one,
  many,
} from "semola/orm";
```

## Define tables

```typescript
const users = createTable("users", {
  id: uuid("id").primaryKey(),
  name: string("name").notNull(),
  email: string("email").unique().notNull(),
  age: number("age"),
  active: boolean("active").default(true),
  createdAt: date("created_at"),
  metadata: json<{ tags: string[] }>("metadata"),
});
```

## Create ORM client

```typescript
const db = createOrm({
  url: "sqlite::memory:",
  tables: { users },
});
```

`dialect` is inferred from `url` (or can be set explicitly to `"sqlite" | "mysql" | "postgres"`).

---

## Query API

Each table client exposes two styles:

- **Result-pattern methods** (recommended app-level DX): return `Promise<[error, data]>`
- **SQL-style methods**: return Bun SQL query objects and execute directly with `await`

### Result-pattern methods

- `findMany(input?)`
- `findFirst(input?)`
- `findUnique({ where })`
- `create({ data })`
- `createMany({ data: [] })`
- `updateMany({ where, data })`
- `deleteMany({ where })`

Return shapes:

- `createMany` -> `[error, { count, rows }]`
- `updateMany` -> `[error, { count, rows }]`
- `deleteMany` -> `[error, { count, rows }]`

Error shape:

```typescript
type OrmResultError = {
  type: string;
  message: string;
};
```

Example:

```typescript
const [err, users] = await db.users.findMany({
  where: { name: { contains: "john" } },
  orderBy: { name: "asc" },
  take: 20,
  skip: 0,
});

if (err) {
  console.error(err.type, err.message);
  return;
}

console.log(users);

const [createManyErr, createdMany] = await db.users.createMany({
  data: [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ],
});

if (createManyErr) {
  console.error(createManyErr.type, createManyErr.message);
  return;
}

console.log(createdMany.count, createdMany.rows);

const [updateManyErr, updatedMany] = await db.users.updateMany({
  where: { active: true },
  data: { active: false },
});

if (updateManyErr) {
  console.error(updateManyErr.type, updateManyErr.message);
  return;
}

console.log(updatedMany.count, updatedMany.rows);

const [deleteManyErr, deletedMany] = await db.users.deleteMany({
  where: { active: false },
});

if (deleteManyErr) {
  console.error(deleteManyErr.type, deleteManyErr.message);
  return;
}

console.log(deletedMany.count, deletedMany.rows);
```

### SQL-style methods

- `select(input?)`
- `insert({ data, returning? })`
- `update({ where, data, returning? })`
- `delete({ where, returning? })`

Example:

```typescript
const rows = await db.users.select({
  where: { active: true },
  limit: 10,
});

const inserted = await db.users.insert({
  data: { name: "Jane", email: "jane@example.com" },
  returning: true,
});
```

---

## Filters & pagination

Supported `where` operators:

- direct equality: `{ email: "a@b.com" }`
- `equals`, `not`
- `in`, `notIn`
- `startsWith`, `endsWith`, `contains`
- `gt`, `gte`, `lt`, `lte`
- `isNull`

Pagination and sorting:

- SQL-style: `limit`, `offset`, `orderBy`
- Result-style: `take`, `skip`, `orderBy`

```typescript
const [err, users] = await db.users.findMany({
  where: {
    age: { gte: 18 },
    name: { startsWith: "A" },
  },
  orderBy: { name: "desc" },
  take: 50,
  skip: 0,
});
```

---

## Relations (`include` joins)

```typescript
const tasks = createTable("tasks", {
  id: uuid("id").primaryKey(),
  assigneeId: uuid("assignee_id").notNull(),
  title: string("title").notNull(),
});

const db = createOrm({
  url: "sqlite::memory:",
  tables: { users, tasks },
  relations: {
    users: {
      tasks: many(() => tasks),
    },
    tasks: {
      assignee: one("assignee_id", () => users),
    },
  },
});

const joined = await db.users.select({
  include: { tasks: true },
});
```

`include` produces SQL joins. It does not perform nested object hydration.

---

## Transactions and raw SQL

```typescript
await db.$transaction(async (tx) => {
  await tx.users.insert({
    data: { name: "A", email: "a@example.com" },
  });

  await tx.users.insert({
    data: { name: "B", email: "b@example.com" },
  });
});

const count = await db.$raw`SELECT COUNT(*) as count FROM users`;
```

---

## Migrations

Semola ORM migrations are schema-snapshot + SQL file based.

### Config

Create `semola.config.ts`:

```typescript
import { defineConfig } from "semola/orm";

export default defineConfig({
  orm: {
    schema: "./src/db/schema.ts",
    migrations: {
      dir: "./migrations",
      stateFile: "./.semola-migrations.json",
      transactional: true,
    },
  },
});
```

### Schema module

Point `orm.schema` to a file exporting your ORM client (default or named export is supported):

```typescript
import { createOrm, createTable, uuid, string } from "semola/orm";

const users = createTable("users", {
  id: uuid("id").primaryKey(),
  name: string("name").notNull(),
});

export default createOrm({
  url: "sqlite::memory:",
  tables: { users },
});
```

### CLI

```bash
semola orm migrations create add-users
semola orm migrations apply
semola orm migrations rollback
```

- `create` diffs the current schema vs last snapshot and generates:
  - `migrations/<id>_<name>/up.sql`
  - `migrations/<id>_<name>/down.sql`
  - `migrations/<id>_<name>/snapshot.json`
- `apply` runs pending `up.sql` files and updates state file
- `rollback` runs latest applied `down.sql` and updates state file

---

## Type exports

Useful exported types include:

- `TableRow<T>`
- `ResultTuple<T>`
- `OrmResultError`
- `FindManyInput<T, TRels>`
- `FindUniqueInput<T>`
- `CreateInput<T>`
- `UpdateManyInput<T>`
- `DeleteManyInput<T>`
