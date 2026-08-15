---
title: Errors
description: Result tuples and mightThrow for explicit error handling
---

Semola's error helpers turn fallible work into **`[error, data]`** tuples. You branch on the error instead of nesting try/catch.

## Import

```typescript
import { ok, err, mightThrow, mightThrowSync } from "semola/errors";
```

## Quick start

The error guard narrows the result tuple: failure logs and returns, while success exposes a typed user.

```typescript
const [error, user] = await getUser("123");

if (error) {
  console.error(error.type, error.message);
  return;
}

console.log(user.email);
```

After the guard, `user` is narrowed. No optional chaining gymnastics.

## The pattern

Every result is a two-element tuple:

- Success: `[null, data]`
- Failure: `[{ type, message }, null]`

## Wrap things that throw

### Async

`mightThrow()` converts each rejected promise into an error-first tuple without throwing.

```typescript
const [error, response] = await mightThrow(fetch("/api/users"));

if (error) {
  // network failure, abort, etc.
  return;
}

const [parseError, body] = await mightThrow(response.json());
```

### Sync

`mightThrowSync()` catches a synchronous parse error, which this function maps to its own `ValidationError`.

```typescript
const [error, value] = mightThrowSync(() => JSON.parse(input));

if (error) {
  return err("ValidationError", "Invalid JSON");
}

return ok(value);
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

This function returns `err()` for validation, network, and parsing failures, or `ok()` with the parsed user.

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

## Examples

### Fetch and parse

Each async operation is handled independently, so parsing only runs after a successful fetch.

```typescript
const [error, response] = await mightThrow(fetch("/api/users"));

if (error) {
  return;
}

const [parseError, body] = await mightThrow(response.json());

if (parseError) {
  return;
}

console.log(body);
```

### Sync parse with `err()`

The parser converts thrown JSON errors into a typed failure tuple and valid JSON into a success tuple.

```typescript
function parseConfig(input: string) {
  const [error, value] = mightThrowSync(() => JSON.parse(input));

  if (error) {
    return err("ValidationError", "Invalid JSON");
  }

  return ok(value);
}
```

### Switch on error type

The discriminant maps expected failures to HTTP status codes while preserving the typed success path.

```typescript
const [error, user] = await getUser(id);

if (error) {
  switch (error.type) {
    case "ValidationError":
      return respond(400, error.message);
    case "NotFoundError":
      return respond(404, error.message);
    default:
      return respond(500, "Unexpected error");
  }
}

return respond(200, user);
```

## Reference

| Export | Meaning |
| --- | --- |
| `ok(data)` | Success tuple `[null, data]` |
| `err(type, message)` | Failure tuple `[{ type, message }, null]` |
| `mightThrow(promise)` | Await a promise into a result tuple |
| `mightThrowSync(fn)` | Run a sync function into a result tuple |
