# Policy

A type-safe policy-based authorization system for defining and enforcing access control rules with conditional logic.

## Import

```typescript
import { Policy, eq, gt, startsWith, has, and } from "semola/policy";
```

## API

**`new Policy<T>()`**

Creates a new policy instance typed to an entity. The type parameter constrains conditions and object checks throughout the policy.

```typescript
type Post = {
  id: number;
  title: string;
  authorId: number;
  status: string;
};

const policy = new Policy<Post>();
```

**`policy.allow(params: AllowParams<T>)`**

Defines a rule that grants permission for an action, optionally with conditions and a reason. `action` accepts a single string or an array of strings.

```typescript
// Allow reading published posts
policy.allow({
  action: "read",
  reason: "Public posts are visible to everyone",
  conditions: {
    status: "published",
  },
});

// Allow creating and updating without conditions
policy.allow({
  action: ["create", "update"],
});

// Allow with a helper function
policy.allow({
  action: "read",
  conditions: {
    title: startsWith("Public"),
  },
});
```

**`policy.forbid(params: ForbidParams<T>)`**

Defines a rule that denies permission for an action, optionally with conditions and a reason. `action` accepts a single string or an array of strings.

```typescript
// Forbid updating published posts
policy.forbid({
  action: "update",
  reason: "Published posts cannot be modified",
  conditions: {
    status: "published",
  },
});

// Forbid multiple actions at once
policy.forbid({
  action: ["create", "delete"],
  reason: "Read-only access",
});
```

**`policy.can(action: Action, object?: T): CanResult`**

Checks if an action is permitted, optionally validating against an object's conditions. Returns a result object with `allowed` (boolean) and optional `reason` (string).

```typescript
const post: Post = {
  id: 1,
  title: "My Post",
  authorId: 1,
  status: "published",
};

policy.can("read", post);
// { allowed: true, reason: "Public posts are visible to everyone" }

policy.can("update", post);
// { allowed: false, reason: "Published posts cannot be modified" }

policy.can("delete");
// { allowed: false, reason: undefined }
```

## Types

```typescript
type Action = "read" | "create" | "update" | "delete" | (string & {});

type Conditions<T> = {
  [K in keyof T]?: T[K] | ConditionHelper<T[K]>;
};

type CanResult = {
  allowed: boolean;
  reason?: string;
};
```

## Features

- **Type-safe conditions**: Conditions are validated against the entity type
- **Flexible actions**: Built-in CRUD actions plus custom string actions
- **Array actions**: Register multiple actions in a single `allow` or `forbid` call
- **Helper functions**: Rich set of typed helpers for comparisons, strings, arrays, and null checks
- **Composable logic**: Combine helpers with `and`, `or`, `not` for complex conditions
- **Adapter-ready**: Each helper carries `operator` and `value` metadata for serialization
- **Multiple conditions**: Rules can match multiple object properties (AND logic)
- **Allow/Forbid semantics**: Explicit permission and denial rules
- **Human-readable reasons**: Optional explanations for authorization decisions
- **No match defaults to deny**: Conservative security model
- **Zero dependencies**: Pure TypeScript implementation

## Helpers

Helper functions express conditions beyond simple equality. Each helper is type-safe and carries metadata (`operator`, `value`) for use in adapters.

### Comparison

| Helper       | Description           |
| ------------ | --------------------- |
| `eq(value)`  | Equal to              |
| `neq(value)` | Not equal to          |
| `gt(value)`  | Greater than          |
| `gte(value)` | Greater than or equal |
| `lt(value)`  | Less than             |
| `lte(value)` | Less than or equal    |

### Logic

| Helper            | Description                    |
| ----------------- | ------------------------------ |
| `not(helper)`     | Negates a helper               |
| `and(...helpers)` | All helpers must match         |
| `or(...helpers)`  | At least one helper must match |

### String

| Helper                | Description               |
| --------------------- | ------------------------- |
| `startsWith(prefix)`  | String starts with prefix |
| `endsWith(suffix)`    | String ends with suffix   |
| `includes(substring)` | String contains substring |
| `matches(pattern)`    | String matches a regex    |

### Array

| Helper          | Description                                       |
| --------------- | ------------------------------------------------- |
| `has(item)`     | Array contains item (or all items if array given) |
| `hasAny(items)` | Array contains at least one item                  |
| `hasLength(n)`  | Length equals `n`, or `{ min?, max? }` range      |
| `isEmpty()`     | Array or string is empty                          |

### Null / Undefined

| Helper        | Description                        |
| ------------- | ---------------------------------- |
| `isDefined()` | Value is not `null` or `undefined` |
| `isNullish()` | Value is `null` or `undefined`     |

```typescript
import { Policy, eq, gt, startsWith, has, and, not } from "semola/policy";

type Post = {
  id: number;
  title: string;
  authorId: number;
  status: "draft" | "published";
  tags: string[];
};

const policy = new Policy<Post>();

// Exact value match
policy.allow({ action: "read", conditions: { status: "published" } });

// Helper conditions
policy.allow({
  action: "read",
  conditions: { title: startsWith("Public") },
});

policy.allow({
  action: "update",
  conditions: { authorId: gt(0), status: not(eq("published")) },
});

policy.allow({
  action: "read",
  conditions: { tags: has("featured") },
});
```

## Usage Example

```typescript
import { Policy } from "semola/policy";

type Post = {
  id: number;
  title: string;
  authorId: number;
  status: string;
};

const policy = new Policy<Post>();

// Define rules with reasons
policy.allow({
  action: "read",
  reason: "Published posts are publicly accessible",
  conditions: {
    status: "published",
  },
});

policy.allow({
  action: "update",
  reason: "Draft posts can be edited",
  conditions: {
    status: "draft",
  },
});

policy.forbid({
  action: "delete",
  reason: "Published posts cannot be deleted",
  conditions: {
    status: "published",
  },
});

// Check permissions
const publishedPost: Post = {
  id: 1,
  title: "Hello World",
  authorId: 1,
  status: "published",
};

const draftPost: Post = {
  id: 2,
  title: "Work in Progress",
  authorId: 1,
  status: "draft",
};

policy.can("read", publishedPost);
// { allowed: true, reason: "Published posts are publicly accessible" }

policy.can("update", draftPost);
// { allowed: true, reason: "Draft posts can be edited" }

policy.can("delete", publishedPost);
// { allowed: false, reason: "Published posts cannot be deleted" }

// Use in authorization middleware
function authorize(action: Action, object?: Post) {
  const result = policy.can(action, object);
  if (!result.allowed) {
    throw new Error(result.reason || "Unauthorized");
  }
}

authorize("delete", publishedPost);
// throws Error: "Published posts cannot be deleted"

authorize("read", publishedPost);
// passes
```
