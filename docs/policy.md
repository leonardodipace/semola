---
title: Policy
description: Allow / forbid rules with composable conditions
---

Express authorization as small rules over an object. Forbid always wins over allow. If no rule matches, the action is denied.

## Import

```typescript
import { Policy, eq, and, or, has } from "semola/policy";
```

## Quick start

Two allow rules grant reading and author edits, then a forbid rule blocks deletion of published posts. `can()` evaluates forbids first.

```typescript
type Post = {
  id: number;
  authorId: number;
  status: "draft" | "published";
  tags: string[];
};

const posts = new Policy<Post>();

const currentUser = { id: 1 };

posts.allow({
  action: "read",
  conditions: { status: eq("published") },
});

posts.allow({
  action: ["update", "delete"],
  conditions: { authorId: eq(currentUser.id) },
  reason: "Authors can edit their own posts",
});

posts.forbid({
  action: "delete",
  conditions: { status: eq("published") },
  reason: "Published posts cannot be deleted",
});

const post: Post = {
  id: 1,
  authorId: currentUser.id,
  status: "draft",
  tags: [],
};

const result = posts.can("update", post);

if (!result.allowed) {
  console.log(result.reason);
  return;
}
```

## Rules

### Allow and forbid

`action` can be a string or an array (one rule covers many verbs). Built-in labels include `"read"`, `"create"`, `"update"`, `"delete"`; custom strings work too.

Omit `conditions` to match every object for that action. Optional `reason` is returned when the rule decides the outcome.

### Evaluation order

1. Matching **forbid** rules win first
2. Then matching **allow** rules
3. Otherwise deny

## Condition helpers

Import what you need from `semola/policy`:

`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `not`, `and`, `or`, `startsWith`, `endsWith`, `includes`, `matches`, `has`, `hasAny`, `hasLength`, `isEmpty`, `isDefined`, `isNullish`

Combine helpers on fields:

Both field conditions must match for the rule to allow `feature`.

```typescript
posts.allow({
  action: "feature",
  conditions: {
    tags: has("featured"),
    status: eq("published"),
  },
});
```

For a one-off check on a field, any object with a `fn` that receives the field value works:

This custom predicate only allows draft posts to be archived.

```typescript
posts.allow({
  action: "archive",
  conditions: {
    status: {
      fn: (status: Post["status"]) => status === "draft",
    },
  },
});
```

## Examples

### Role-based create

Every authenticated user can create, while only public or owned documents can be read.

```typescript
type Document = {
  ownerId: string;
  visibility: "private" | "public";
};

const user = { id: "user-1" };
const docs = new Policy<Document>();

docs.allow({
  action: "create",
  reason: "Authenticated users can create",
});

docs.allow({
  action: "read",
  conditions: { visibility: eq("public") },
});

docs.allow({
  action: ["read", "update", "delete"],
  conditions: { ownerId: eq(user.id) },
});
```

### Forbid overrides allow

Although the author matches the allow rule, the published-state forbid rule wins and returns its reason.

```typescript
const user = { id: 1 };
const publishedPost: Post = {
  id: 1,
  authorId: user.id,
  status: "published",
  tags: [],
};

posts.allow({
  action: "delete",
  conditions: { authorId: eq(user.id) },
});

posts.forbid({
  action: "delete",
  conditions: { status: eq("published") },
  reason: "Cannot delete published posts",
});

// author of a published post → denied with the forbid reason
posts.can("delete", publishedPost);
```

### Tag helpers

The rule allows promotion only when a published post has at least one featured tag.

```typescript
posts.allow({
  action: "promote",
  conditions: {
    tags: hasAny(["featured", "editors-pick"]),
    status: eq("published"),
  },
});
```

### Custom field predicate

The inline predicate allows publishing only when the post has at least one tag.

```typescript
posts.allow({
  action: "publish",
  conditions: {
    tags: {
      fn: (tags: string[]) => tags.length > 0,
    },
  },
});
```

## Reference

### Methods

| Method | Meaning |
| --- | --- |
| `allow({ action, conditions?, reason? })` | Add an allow rule |
| `forbid({ action, conditions?, reason? })` | Add a forbid rule |
| `can(action, object?)` | Returns `{ allowed: boolean, reason?: string }` |

### Helpers

Comparison: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`

Logic: `not`, `and`, `or`

Strings / collections: `startsWith`, `endsWith`, `includes`, `matches`, `has`, `hasAny`, `hasLength`, `isEmpty`

Presence: `isDefined`, `isNullish`
