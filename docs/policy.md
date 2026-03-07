# Policy

A type-safe policy-based authorization system for defining and enforcing access control rules with conditional logic.

## Import

```typescript
import { Policy } from "semola/policy";
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

// Allow with a predicate function
policy.allow({
  action: "read",
  conditions: {
    title: (v) => v.startsWith("Public"),
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
  [K in keyof T]?: T[K] | ((value: T[K]) => boolean);
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
- **Predicate conditions**: Use functions for dynamic condition matching
- **Multiple conditions**: Rules can match multiple object properties (AND logic)
- **Allow/Forbid semantics**: Explicit permission and denial rules
- **Human-readable reasons**: Optional explanations for authorization decisions
- **No match defaults to deny**: Conservative security model
- **Zero dependencies**: Pure TypeScript implementation

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
