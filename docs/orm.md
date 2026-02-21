# ORM

A type-safe SQL ORM with result-based error handling, relation support, and automatic migration generation. Supports SQLite, MySQL, and PostgreSQL via Bun's native SQL client.

## Import

```typescript
import {
  Orm,
  Table,
  string,
  number,
  boolean,
  date,
  json,
  jsonb,
  uuid,
  one,
  many,
  defineMigration,
} from "semola/orm";
```

## API

**`new Orm(options: OrmOptions)`**

Creates a new ORM instance connected to a database.

```typescript
type OrmError = "ConnectionError" | "TransactionError" | "QueryError";

type OrmOptions = {
  url: string; // Database connection URL
  tables: Table[]; // Table definitions
  relations?: Record<string, OneRelation | ManyRelation>; // Relation definitions
  dialect?: "sqlite" | "mysql" | "postgres"; // Auto-detected from URL
};

type OrmDialect = "sqlite" | "mysql" | "postgres";

const orm = new Orm({
  url: "sqlite://./data.db",
  tables: [users, posts],
  relations: {
    userPosts: many(posts.authorId, () => users),
  },
});
```

**`orm.tables[tableName]`**

Bound table clients for each defined table, providing CRUD operations.

```typescript
// Assuming tables: [users, posts]
const [error, user] = await orm.tables.users.findUnique({
  where: { id: 1 },
});
```

**`orm.transaction(fn: (tx: Transaction) => Promise<T>)`**

Executes a function within a database transaction. Rolls back on error.

```typescript
const [error, result] = await orm.transaction(async (tx) => {
  const [err1, user] = await tx.tables.users.create({ name: "John" });
  if (err1) return err(err1.type, err1.message);

  const [err2, post] = await tx.tables.posts.create({ authorId: user.id });
  if (err2) return err(err2.type, err2.message);

  return ok({ user, post });
});
```

**`orm.close()`**

Closes the database connection.

```typescript
await orm.close();
```

### Table Definition

**`new Table(name: string, columns: Record<string, Column>)`**

Defines a database table structure.

```typescript
const users = new Table("users", {
  id: number().primaryKey(),
  name: string().notNull(),
  email: string().unique().notNull(),
  age: number(),
  active: boolean().default(true),
  createdAt: date().default(() => new Date()),
  metadata: json(),
});
```

### Column Types

**`string(options?: { length?: number })`**

String/text column.

```typescript
const users = new Table("users", {
  name: string(),
  code: string({ length: 10 }), // VARCHAR(10)
});
```

**`number()`**

Numeric column (INTEGER for SQLite, INT/NUMBER for others).

```typescript
const products = new Table("products", {
  price: number().notNull(),
  quantity: number().default(0),
});
```

**`boolean()`**

Boolean column. Stored as INTEGER in SQLite, BOOLEAN in others.

```typescript
const tasks = new Table("tasks", {
  completed: boolean().default(false),
});
```

**`date()`**

Date/timestamp column.

```typescript
const events = new Table("events", {
  scheduledAt: date().notNull(),
  createdAt: date().default(() => new Date()),
});
```

**`json()`**

JSON column. Stored as TEXT in SQLite, JSON in MySQL/PostgreSQL.

```typescript
const configs = new Table("configs", {
  settings: json(),
});
```

**`jsonb()`**

Binary JSON column. PostgreSQL only.

```typescript
const logs = new Table("logs", {
  data: jsonb(),
});
```

**`uuid()`**

UUID column. Generates v4 UUIDs automatically.

```typescript
const sessions = new Table("sessions", {
  token: uuid().primaryKey(),
});
```

### Column Modifiers

Chain modifiers on any column:

- `.primaryKey()` - Mark as primary key
- `.notNull()` - Add NOT NULL constraint
- `.unique()` - Add UNIQUE constraint
- `.default(value | () => value)` - Set default value

### Table Client Operations

**`table.findMany(options?: FindOptions<T>)`**

Query multiple rows with filtering, pagination, and relation includes.

```typescript
type FindOptions<T> = {
  where?: WhereClause<T>;
  take?: number;
  skip?: number;
  orderBy?: { column: keyof T; direction: "asc" | "desc" };
  include?: IncludeOptions<T>;
};

type WhereClause<T> = {
  [K in keyof T]?:
    | T[K]
    | {
        equals?: T[K];
        gt?: T[K];
        gte?: T[K];
        lt?: T[K];
        lte?: T[K];
        contains?: T[K];
        in?: T[K][];
      };
};

const [error, users] = await orm.tables.users.findMany({
  where: { age: { gte: 18 }, active: true },
  take: 10,
  skip: 0,
  orderBy: { column: "createdAt", direction: "desc" },
});
```

**`table.findFirst(options?: FindOptions<T>)`**

Query the first matching row.

```typescript
const [error, user] = await orm.tables.users.findFirst({
  where: { email: "john@example.com" },
});
```

**`table.findUnique(options: { where: UniqueWhere<T> })`**

Query by unique key (primary key or unique column).

```typescript
const [error, user] = await orm.tables.users.findUnique({
  where: { id: 1 },
});
```

**`table.count(options?: { where?: WhereClause<T> })`**

Count matching rows.

```typescript
const [error, count] = await orm.tables.users.count({
  where: { active: true },
});
```

**`table.create(data: CreateInput<T>)`**

Insert a single row. Returns the created row with generated fields.

```typescript
type CreateInput<T> = Omit<T, PrimaryKey | GeneratedFields> &
  Partial<Pick<T, GeneratedFields>>;

const [error, user] = await orm.tables.users.create({
  name: "John Doe",
  email: "john@example.com",
  age: 30,
});
```

**`table.createMany(data: CreateInput<T>[])`**

Insert multiple rows.

```typescript
const [error, users] = await orm.tables.users.createMany([
  { name: "John", email: "john@example.com" },
  { name: "Jane", email: "jane@example.com" },
]);
```

**`table.update(options: { where: UniqueWhere<T>; data: UpdateInput<T> })`**

Update a row by unique key.

```typescript
type UpdateInput<T> = Partial<Omit<T, PrimaryKey>>;

const [error, user] = await orm.tables.users.update({
  where: { id: 1 },
  data: { name: "John Updated", age: 31 },
});
```

**`table.upsert(options: { where: UniqueWhere<T>; create: CreateInput<T>; update: UpdateInput<T> })`**

Insert or update a row.

```typescript
const [error, user] = await orm.tables.users.upsert({
  where: { email: "john@example.com" },
  create: { name: "John", email: "john@example.com", age: 30 },
  update: { age: 30 },
});
```

**`table.delete(options: { where: UniqueWhere<T> })`**

Delete a row by unique key.

```typescript
const [error, user] = await orm.tables.users.delete({
  where: { id: 1 },
});
```

### Relations

**`one(foreignKeyColumn: Column, targetTable: () => Table)`**

Defines a one-to-one relation where the parent has a foreign key to the child.

```typescript
const posts = new Table("posts", {
  id: number().primaryKey(),
  authorId: number().notNull(),
  title: string(),
});

const orm = new Orm({
  url: "sqlite://./data.db",
  tables: [users, posts],
  relations: {
    postAuthor: one(posts.authorId, () => users),
  },
});
```

**`many(foreignKeyColumn: Column, targetTable: () => Table)`**

Defines a one-to-many relation where children have a foreign key to the parent.

```typescript
const orm = new Orm({
  url: "sqlite://./data.db",
  tables: [users, posts],
  relations: {
    userPosts: many(posts.authorId, () => users),
  },
});
```

### Eager Loading

Include related data in queries using the `include` option:

```typescript
const [error, user] = await orm.tables.users.findUnique({
  where: { id: 1 },
  include: {
    userPosts: true, // Include all posts
  },
});

// Result type: User & { userPosts: Post[] }
console.log(user.userPosts);
```

### Type Inference

**`InferTableType<T>`**

Extract TypeScript types from table definitions.

```typescript
import type { InferTableType } from "semola/orm";

type User = InferTableType<typeof users>;
// { id: number; name: string; email: string; age: number | null; active: boolean; createdAt: Date; metadata: unknown }
```

### Migrations

**`defineMigration(options: MigrationOptions)`**

Define a database migration with schema changes.

```typescript
type MigrationOptions = {
  name: string;
  up: (builder: SchemaBuilder) => void;
  down?: (builder: SchemaBuilder) => void;
};

type SchemaBuilder = {
  createTable: (name: string, columns: Record<string, Column>) => void;
  dropTable: (name: string) => void;
  addColumn: (table: string, name: string, column: Column) => void;
  dropColumn: (table: string, name: string) => void;
  alterColumn: (table: string, name: string, column: Column) => void;
  createIndex: (
    table: string,
    columns: string[],
    options?: { unique?: boolean; name?: string },
  ) => void;
  dropIndex: (table: string, name: string) => void;
};

const migration = defineMigration({
  name: "add_user_profiles",
  up: (builder) => {
    builder.createTable("profiles", {
      id: number().primaryKey(),
      userId: number().notNull().unique(),
      bio: string(),
    });

    builder.addColumn("users", "phone", string());
  },
  down: (builder) => {
    builder.dropTable("profiles");
    builder.dropColumn("users", "phone");
  },
});
```

## Usage Example

```typescript
import {
  Orm,
  Table,
  string,
  number,
  boolean,
  date,
  one,
  many,
} from "semola/orm";
import type { InferTableType } from "semola/orm";

// Define tables
const users = new Table("users", {
  id: number().primaryKey(),
  name: string().notNull(),
  email: string().unique().notNull(),
  active: boolean().default(true),
  createdAt: date().default(() => new Date()),
});

const posts = new Table("posts", {
  id: number().primaryKey(),
  authorId: number().notNull(),
  title: string().notNull(),
  published: boolean().default(false),
});

// Create ORM with relations
const orm = new Orm({
  url: "sqlite://./blog.db",
  tables: [users, posts],
  relations: {
    postAuthor: one(posts.authorId, () => users),
    userPosts: many(posts.authorId, () => users),
  },
});

// Type inference
type User = InferTableType<typeof users>;
type Post = InferTableType<typeof posts>;

// Create a user
async function createUser(name: string, email: string) {
  const [error, user] = await orm.tables.users.create({
    name,
    email,
  });

  if (error) {
    return err(error.type, error.message);
  }

  return ok(user);
}

// Create a post with transaction
async function createPostWithAuthor(authorId: number, title: string) {
  return orm.transaction(async (tx) => {
    // Verify author exists
    const [authorError, author] = await tx.tables.users.findUnique({
      where: { id: authorId },
    });

    if (authorError) {
      return err(authorError.type, "Author not found");
    }

    // Create post
    const [postError, post] = await tx.tables.posts.create({
      authorId,
      title,
    });

    if (postError) {
      return err(postError.type, postError.message);
    }

    return ok({ author, post });
  });
}

// Query with filters and includes
async function getActiveUsersWithPosts() {
  const [error, users] = await orm.tables.users.findMany({
    where: { active: true },
    include: { userPosts: true },
    orderBy: { column: "createdAt", direction: "desc" },
    take: 10,
  });

  if (error) {
    return err(error.type, error.message);
  }

  // TypeScript knows user.userPosts is Post[]
  return ok(users);
}

// Update user
async function updateUserEmail(userId: number, newEmail: string) {
  const [error, user] = await orm.tables.users.update({
    where: { id: userId },
    data: { email: newEmail },
  });

  if (error) {
    return err(error.type, error.message);
  }

  return ok(user);
}
```

### Database URLs

SQLite:

```typescript
const orm = new Orm({
  url: "sqlite://./local.db",
  tables: [users, posts],
});
```

MySQL:

```typescript
const orm = new Orm({
  url: "mysql://user:pass@localhost:3306/mydb",
  tables: [users, posts],
});
```

PostgreSQL:

```typescript
const orm = new Orm({
  url: "postgres://user:pass@localhost:5432/mydb",
  tables: [users, posts],
});
```

The dialect is automatically detected from the URL prefix. You can override it with the `dialect` option if needed.
