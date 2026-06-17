# ORM

Semola ORM is a type-safe data layer for Bun built on top of the Bun SQL API.

It provides:

- Strong TypeScript inference from table definitions
- Full CRUD methods with precise return types
- Lightweight relations via `include` joins

## Import

```typescript
import {
  createOrm,
  defineTable,
  string,
  number,
  boolean,
  date,
  uuid,
  json,
  jsonb,
  one,
  many,
} from "semola/orm";
```

## Define tables

```typescript
const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  name: string("name").notNull(),
  email: string("email").unique().notNull(),
  age: number("age"),
  active: boolean("active").default(() => true),
  createdAt: date("created_at"),
});
```

Column builders support: `.primaryKey()`, `.notNull()`, `.nullable()`, `.unique()`, `.default(fn)`, `.references(fn)`.

### JSON columns

Use `json<T>` or `jsonb<T>` for structured JSON values. The type parameter defines the TypeScript type of the column value. Values are automatically serialized with `JSON.stringify` on write and parsed with `JSON.parse` on read.

```typescript
type Meta = {
  isActive: boolean;
};

const table = defineTable("table", {
  id: uuid("id").primaryKey().notNull(),
  meta: json<Meta>("meta").default(() => ({ isActive: true })),
  extra: jsonb<{ tags: string[] }>("extra").nullable(),
});
```

`json` and `jsonb` are semantically equivalent in SQLite (both stored as TEXT). Use `jsonb` when targeting PostgreSQL for native binary JSON storage.

## Create ORM client

```typescript
const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
});
```

`adapter` must be set explicitly. Supported values are `"sqlite"` and `"postgres"`.

`$raw` on the returned client is the underlying `Bun.SQL` instance.

---

## Query API

Each table client exposes the following methods:

### Read

- `findMany(options?)` - returns `Promise<Row[]>`
- `findFirst(options?)` - returns `Promise<Row | null>`
- `findUnique({ where, select?, include? })` - returns `Promise<Row | null>`

`findMany` accepts `where`, `select`, `orderBy`, `include`, `take`, `skip`.

`findFirst` accepts the same options as `findMany` except `take`.

`findUnique` requires at least one unique or primary key field in `where`; additional non-unique filters are allowed.

### Write

- `create({ data, select?, include? })` - returns `Promise<Row>`
- `createMany({ data })` - returns `Promise<Row[]>`
- `update({ where, data, select?, include? })` - returns `Promise<Row>`
- `updateMany({ where?, data })` - returns `Promise<Row[]>`
- `delete({ where, select?, include? })` - returns `Promise<Row>`
- `deleteMany({ where? })` - returns `Promise<Row[]>`

`update` and `delete` use the same unique-column `where` constraint as `findUnique`.

Example:

```typescript
const users = await db.users.findMany({
  where: { name: { contains: "john" } },
  orderBy: { name: "asc" },
  take: 20,
  skip: 0,
});

const user = await db.users.create({
  data: { id: "1", name: "Alice", email: "alice@example.com" },
});

const createdUsers = await db.users.createMany({
  data: [
    { id: "2", name: "Bob", email: "bob@example.com" },
    { id: "3", name: "Carol", email: "carol@example.com" },
  ],
});

const updated = await db.users.update({
  where: { id: "1" },
  data: { name: "Alicia" },
});

const updatedUsers = await db.users.updateMany({
  where: { active: false },
  data: { active: true },
});

const deleted = await db.users.delete({
  where: { id: "1" },
});

const deletedUsers = await db.users.deleteMany({
  where: { active: false },
});
```

---

## Filters & pagination

Pass a direct value for equality or an operator object for other comparisons.

String operators: `equals`, `startsWith`, `endsWith`, `contains`, `in`, `notIn`

Number and date operators: `equals`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `notIn`

`between` accepts a 2-element tuple `[min, max]` for an inclusive range on number and date columns.

Boolean operators: `equals`, `in`, `notIn`

Enum operators: `equals`, `in`, `notIn`

JSON operators: `equals`, `in`, `notIn`

Logical operators:

- `$and`: all nested filters must match. Accepts a single `where` object or an array of `where` objects.
- `$or`: at least one nested filter must match. Accepts an array of `where` objects.
- `$not`: nested filters must not match. Accepts a single `where` object or an array of `where` objects.

Logical operators can be nested recursively and can be combined with column filters at any level.

Edge cases:

- `$or: []` matches no rows.
- `$and: []` is ignored and matches all rows when used alone.
- An empty filter object inside `$or` (for example `{}`) matches all rows for that branch.

```typescript
const users = await db.users.findMany({
  where: {
    age: { between: [18, 65] },
    createdAt: { between: [startDate, endDate] },
    name: { startsWith: "A" },
  },
  orderBy: { name: "desc" },
  take: 50,
  skip: 0,
});
```

```typescript
const users = await db.users.findMany({
  where: {
    active: true,
    $or: [
      { name: { contains: "Ada" } },
      {
        $and: [
          { age: { gte: 18 } },
          { createdAt: { gt: new Date("2025-01-01") } },
        ],
      },
    ],
    $not: {
      email: { endsWith: "@example.test" },
    },
  },
});
```

Relation filters filter parent rows based on related records. Use one or more of `every`, `some`, and `none` per relation; multiple quantifiers are combined with AND:

- `every`: all related records match the nested filter (parents with no related records also match)
- `some`: at least one related record matches
- `none`: no related records match (`none: {}` matches parents with no related records)

```typescript
const users = await db.users.findMany({
  where: {
    posts: { every: { published: true } },
  },
});

const popularAuthors = await db.users.findMany({
  where: {
    posts: { some: { views: { gt: 100 } } },
  },
});

const usersWithoutPosts = await db.users.findMany({
  where: {
    posts: { none: {} },
  },
});

const carefulAuthors = await db.users.findMany({
  where: {
    posts: {
      none: { views: { gt: 100 } },
      every: { likes: { lte: 50 } },
    },
  },
});
```

Relation filters compose with column filters and logical operators.

---

## Select

Pass a `select` object to return only specific columns:

```typescript
const users = await db.users.findMany({
  select: { id: true, name: true },
});
```

---

## Relations (`include` joins)

```typescript
const tasks = defineTable("tasks", {
  id: uuid("id").primaryKey().notNull(),
  assigneeId: uuid("assignee_id")
    .references(() => users.columns.id)
    .notNull(),
  title: string("title").notNull(),
});

const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users, tasks },
  relations: {
    users: {
      tasks: many(() => tasks),
    },
    tasks: {
      assignee: one("assigneeId", () => users),
    },
  },
});

const withTasks = await db.users.findMany({
  include: { tasks: true },
});
```

`include` produces SQL joins. Pass `true` to include a relation, omit or pass `false` to exclude it.

You can also pass relation query options. Nested `include` is recursive, and every nested relation can define its own `where`, `orderBy`, `take`, `skip`, `select`, and `include`.

```typescript
const usersWithOpenTasks = await db.users.findMany({
  where: {
    active: true,
  },
  include: {
    tasks: {
      where: {
        $or: [
          { title: { contains: "release" } },
          { title: { startsWith: "fix" } },
        ],
      },
      orderBy: { title: "asc" },
      take: 10,
      select: { id: true, title: true },
      include: {
        assignee: {
          where: {
            $not: { active: false },
          },
          select: { id: true, name: true },
        },
      },
    },
  },
});
```

---

## Transactions

Use `$transaction` to run multiple operations in a single database transaction. The callback receives a transaction client with the same table clients as the root ORM client, plus `$raw` bound to the transactional connection.

On success, the transaction commits. If the callback throws, the transaction rolls back and the error is rethrown.

```typescript
const { user, account } = await db.$transaction(async (tx) => {
  const user = await tx.users.create({
    data: { id: "1", name: "Alice", email: "alice@example.com" },
  });

  const account = await tx.accounts.create({
    data: { id: "a1", userId: user.id, balance: "1000" },
  });

  return { user, account };
});
```

The transaction client does not expose `$transaction`. Starting another transaction from inside a callback (for example by calling `db.$transaction` via closure) is not supported and throws from the underlying driver.

Within a transaction, use the `tx` table clients or `tx.$raw` for all reads and writes. Using the root `db` client inside the callback runs outside the transaction.

---

## Raw SQL

Access the underlying `Bun.SQL` instance via `$raw`:

```typescript
const rows = await db.$raw`SELECT COUNT(*) as count FROM users`;
```

---

## Type exports

Useful exported types include:

- `TableRow<T>`
- `FindManyOptions<T, TRelations>`
- `FindFirstOptions<T, TRelations>`
- `FindUniqueOptions<T, TRelations>`
- `CreateOptions<T, TRelations>`
- `CreateManyOptions<T>`
- `UpdateOptions<T, TRelations>`
- `UpdateManyOptions<T>`
- `DeleteOptions<T, TRelations>`
- `DeleteManyOptions<T>`
- `CreateData<T>`
- `UpdateData<T>`
- `TransactionClient<T, R>`
