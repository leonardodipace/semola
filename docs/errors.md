# Error Utilities

Result-based error handling inspired by functional programming patterns. Avoid throwing exceptions and handle errors explicitly with type-safe tuples.

## Import

```typescript
import { ok, err, mightThrow, mightThrowSync } from "semola/errors";
```

## API

**`ok<T>(data: T)`**

Creates a successful result tuple.

```typescript
const result = ok({ userId: 123, name: "John" });
// [null, { userId: 123, name: "John" }]

const [error, data] = result;

if (error) {
  // Handle error
} else {
  console.log(data.userId); // Type-safe access
}
```

**`err<T>(type: T, message: string)`**

Creates an error result tuple with a typed error object.

```typescript
const result = err("NotFoundError", "User not found");
// [{ type: "NotFoundError", message: "User not found" }, null]

const [error, data] = result;

if (error) {
  console.log(error.type);    // "NotFoundError"
  console.log(error.message); // "User not found"
}
```

**Common error types:** `NotFoundError`, `UnauthorizedError`, `InternalServerError`, `ValidationError`, or any custom string.

**`mightThrow<T>(promise: Promise<T>)`**

Wraps async operations that might throw into result tuples.

```typescript
const [error, data] = await mightThrow(fetch('/api/users'));

if (error) {
  console.error("Request failed:", error);
  return;
}

console.log("Success:", data);
```

**`mightThrowSync<T>(fn: () => T)`**

Wraps synchronous operations that might throw into result tuples.

```typescript
const [error, data] = mightThrowSync(() => JSON.parse(input));

if (error) {
  console.error("Parse failed:", error);
  return;
}

console.log("Parsed:", data);
```

## Usage Example

```typescript
import { ok, err, mightThrow } from "semola/errors";

async function getUser(id: string) {
  if (!id) {
    return err("ValidationError", "User ID is required");
  }

  const [fetchError, response] = await mightThrow(
    fetch(`/api/users/${id}`)
  );

  if (fetchError) {
    return err("InternalServerError", "Failed to fetch user");
  }

  const [parseError, user] = await mightThrow(response.json());

  if (parseError) {
    return err("InternalServerError", "Invalid response format");
  }

  return ok(user);
}

// Usage
const [error, user] = await getUser("123");

if (error) {
  switch (error.type) {
    case "ValidationError":
      console.log("Validation failed:", error.message);
      break;
    case "NotFoundError":
      console.log("User not found");
      break;
    default:
      console.log("Error:", error.message);
  }
} else {
  console.log("User:", user);
}
```
