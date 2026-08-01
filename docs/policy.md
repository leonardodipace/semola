---
title: Policy
description: Allow / forbid rules with composable conditions
---

Express authorization as small rules over an object. Forbid always wins over allow.

```typescript
import { Policy, eq, and, or, has } from "semola/policy";
```

## Define rules

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
```

## Check

```typescript
const post = {
  id: 1,
  authorId: 1,
  status: "draft" as const,
  tags: ["notes"],
};

const result = posts.can("update", post);

if (!result.allowed) {
  console.log(result.reason);
  return;
}

// proceed
```

`action` can be a string or an array (one rule covers many verbs). Omit `conditions` to match every object for that action.

## Condition helpers

Import what you need from `semola/policy`:

`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `not`, `and`, `or`, `startsWith`, `endsWith`, `includes`, `matches`, `has`, `hasAny`, `hasLength`, `isEmpty`, `isDefined`, `isNullish`

Combine helpers on fields:

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
