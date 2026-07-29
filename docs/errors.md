---
title: Errors
description: Result tuples and mightThrow for explicit error handling
---

Semola's error helpers turn fallible work into **`[error, data]`** tuples. You branch on the error instead of nesting try/catch.

```typescript
import { ok, err, mightThrow, mightThrowSync } from "semola/errors";
```

## The pattern

Every result is a two-element tuple:

- Success: `[null, data]`
- Failure: `[{ type, message }, null]`

```typescript
const [error, user] = await getUser("123");

if (error) {
  console.error(error.type, error.message);
  return;
}

console.log(user.email);
```

After the guard, `user` is narrowed. No optional chaining gymnastics.

## Wrap things that throw

**Async:**

```typescript
const [error, response] = await mightThrow(fetch("/api/users"));

if (error) {
  // network failure, abort, etc.
  return;
}

const [parseError, body] = await mightThrow(response.json());
```

**Sync:**

```typescript
const [error, value] = mightThrowSync(() => JSON.parse(input));

if (error) {
  return err("ValidationError", "Invalid JSON");
}
```

By default the error side is typed as `Error`. If something rejects with a custom shape, pass a generic:

```typescript
const [error] = await mightThrow<never, { code: string }>(
  Promise.reject({ code: "RATE_LIMITED" }),
);

if (error) {
  console.log(error.code);
}
```

## Return your own results

Build functions that speak the same dialect:

```typescript
async function getUser(id: string) {
  if (!id) {
    return err("ValidationError", "User ID is required");
  }

  const [fetchError, response] = await mightThrow(fetch(`/api/users/${id}`));

  if (fetchError) {
    return err("InternalServerError", "Failed to fetch user");
  }

  const [parseError, user] = await mightThrow(response.json());

  if (parseError) {
    return err("InternalServerError", "Invalid response format");
  }

  return ok(user);
}

const [error, user] = await getUser("123");

if (error) {
  switch (error.type) {
    case "ValidationError":
      // ...
      break;
    default:
      console.error(error.message);
  }
  return;
}

console.log(user);
```

`err(type, message)` accepts common labels like `NotFoundError`, `UnauthorizedError`, `ValidationError`, `InternalServerError`, `MigrationError`, `SchemaError`, or any other string you want to use as a discriminant.
