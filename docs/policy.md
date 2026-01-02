# Policy

A type-safe policy-based authorization system for defining and enforcing access control rules with conditional logic.

## Import

```typescript
import { Policy } from "semola/policy";
```

## API

**`new Policy()`**

Creates a new policy instance for managing authorization rules.

```typescript
const policy = new Policy();
```

**`policy.allow<T>(params: AllowParams<T>)`**

Defines a rule that grants permission for an action on an entity, optionally with conditions and a reason.

```typescript
type Post = {
  id: number;
  title: string;
  authorId: number;
  status: string;
};

// Allow reading all published posts
policy.allow<Post>({
  action: "read",
  entity: "Post",
  reason: "Public posts are visible to everyone",
  conditions: {
    status: "published"
  }
});

// Allow all read access without conditions
policy.allow({
  action: "read",
  entity: "Comment",
  reason: "Comments are public"
});
```

**`policy.forbid<T>(params: ForbidParams<T>)`**

Defines a rule that denies permission for an action on an entity, optionally with conditions and a reason.

```typescript
// Forbid updating published posts
policy.forbid<Post>({
  action: "update",
  entity: "Post",
  reason: "Published posts cannot be modified",
  conditions: {
    status: "published"
  }
});

// Forbid deleting admin users
policy.forbid({
  action: "delete",
  entity: "User",
  reason: "You cannot delete admins"
});
```

**`policy.can<T>(action: Action, entity: Entity, object?: T): CanResult`**

Checks if an action is permitted on an entity, optionally validating against an object's conditions. Returns a result object with `allowed` (boolean) and optional `reason` (string).

```typescript
const post: Post = {
  id: 1,
  title: "My Post",
  authorId: 1,
  status: "published"
};

policy.can<Post>("read", "Post", post);
// { allowed: true, reason: "Public posts are visible to everyone" }

policy.can<Post>("update", "Post", post);
// { allowed: false, reason: "Published posts cannot be modified" }

policy.can("delete", "Post");
// { allowed: false, reason: undefined }
```

## Types

```typescript
type Action = "read" | "create" | "update" | "delete" | (string & {});
type Entity = string;
type Conditions<T> = Partial<T>;

type CanResult = {
  allowed: boolean;
  reason?: string;
};
```

## Features

- **Type-safe conditions**: Conditions are validated against the object type
- **Flexible actions**: Built-in CRUD actions plus custom string actions
- **Multiple conditions**: Rules can match multiple object properties
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

// Create policy
const policy = new Policy();

// Define rules with reasons
policy.allow<Post>({
  action: "read",
  entity: "Post",
  reason: "Published posts are publicly accessible",
  conditions: {
    status: "published"
  }
});

policy.allow<Post>({
  action: "update",
  entity: "Post",
  reason: "Draft posts can be edited",
  conditions: {
    status: "draft"
  }
});

policy.forbid<Post>({
  action: "delete",
  entity: "Post",
  reason: "Published posts cannot be deleted",
  conditions: {
    status: "published"
  }
});

// Check permissions
const publishedPost: Post = {
  id: 1,
  title: "Hello World",
  authorId: 1,
  status: "published"
};

const draftPost: Post = {
  id: 2,
  title: "Work in Progress",
  authorId: 1,
  status: "draft"
};

// Check permissions with reasons
const readResult = policy.can<Post>("read", "Post", publishedPost);
console.log(readResult);
// { allowed: true, reason: "Published posts are publicly accessible" }

const updateDraftResult = policy.can<Post>("update", "Post", draftPost);
console.log(updateDraftResult);
// { allowed: true, reason: "Draft posts can be edited" }

const deleteResult = policy.can<Post>("delete", "Post", publishedPost);
console.log(deleteResult);
// { allowed: false, reason: "Published posts cannot be deleted" }

// Use in authorization middleware
function authorize<T>(action: Action, entity: Entity, object?: T) {
  const result = policy.can(action, entity, object);
  if (!result.allowed) {
    throw new Error(result.reason || "Unauthorized");
  }
}

// Protect routes with meaningful error messages
authorize<Post>("delete", "Post", publishedPost);
// throws Error: "Published posts cannot be deleted"

authorize<Post>("read", "Post", publishedPost);
// passes
```
