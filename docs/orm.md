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

## Create ORM client

```typescript
const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
});
```

`adapter` must be set explicitly. Currently `"sqlite"` is the only supported value.

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

`findUnique` requires exactly one unique column (primary key or `.unique()`) in `where`.

### Write

- `create({ data, select?, include? })` - returns `Promise<Row>`
- `createMany({ data })` - returns `Promise<{ count: number }>`
- `update({ where, data, select?, include? })` - returns `Promise<Row>`
- `updateMany({ where?, data })` - returns `Promise<{ count: number }>`
- `delete({ where, select?, include? })` - returns `Promise<Row>`
- `deleteMany({ where? })` - returns `Promise<{ count: number }>`

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

const { count } = await db.users.createMany({
  data: [
    { id: "2", name: "Bob", email: "bob@example.com" },
    { id: "3", name: "Carol", email: "carol@example.com" },
  ],
});

const updated = await db.users.update({
  where: { id: "1" },
  data: { name: "Alicia" },
});

const { count: updatedCount } = await db.users.updateMany({
  where: { active: false },
  data: { active: true },
});

const deleted = await db.users.delete({
  where: { id: "1" },
});

const { count: deletedCount } = await db.users.deleteMany({
  where: { active: false },
});
```

---

## Filters & pagination

Pass a direct value for equality or an operator object for other comparisons.

String operators: `equals`, `startsWith`, `endsWith`, `contains`

Number and date operators: `equals`, `gt`, `gte`, `lt`, `lte`

Boolean operators: `equals`

```typescript
const users = await db.users.findMany({
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
  assigneeId: uuid("assignee_id").notNull(),
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
      assignee: one(() => users),
    },
  },
});

const withTasks = await db.users.findMany({
  include: { tasks: true },
});
```

`include` produces SQL joins. Pass `true` to include a relation, omit or pass `false` to exclude it.

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
- `BulkResult`
- `CreateData<T>`
- `UpdateData<T>`
