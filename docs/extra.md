---
title: Extra
description: Small helpers that do not need their own package
---

Odds and ends that are useful but too small for a dedicated module. Today that means retries with full-jitter backoff.

## Import

```typescript
import { createRetry } from "semola/extra";
```

## Quick start

```typescript
const fetchUser = createRetry(
  async (id: string) => {
    const res = await fetch(`/users/${id}`);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return res.json();
  },
  { maxRetries: 3 },
);

const user = await fetchUser("123");
```

`createRetry` returns an async function with the same parameters as `fn`. Backoff uses full jitter: about 1s base, ×2 per attempt, capped at 60s.

## Options

| Option | Meaning |
| --- | --- |
| `maxRetries` | Required. Non-negative integer |
| `id` | Optional label for callbacks |
| `onFailedAttempt` | Called after each failed attempt |
| `onError` | Called when retries are exhausted; if it returns, the wrapper resolves to `undefined` instead of throwing |
| `retryOnError` | `({ error, id }) => boolean` — return `false` to stop (default: retry all) |

Invalid config throws `InvalidRetryError` (exported from `semola/extra`).

## Examples

### Example: Log failed attempts

```typescript
const fetchUser = createRetry(
  async (id: string) => {
    const res = await fetch(`/users/${id}`);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return res.json();
  },
  {
    maxRetries: 3,
    onFailedAttempt: ({ error, attemptNumber }) => {
      console.warn(`attempt ${attemptNumber} failed`, error);
    },
  },
);
```

### Example: Stop retrying on 404

```typescript
const fetchUser = createRetry(
  async (id: string) => {
    const res = await fetch(`/users/${id}`);

    if (res.status === 404) {
      throw Object.assign(new Error("not found"), { status: 404 });
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return res.json();
  },
  {
    maxRetries: 5,
    retryOnError: ({ error }) =>
      !(error instanceof Error && "status" in error && error.status === 404),
  },
);
```

### Example: Swallow final error

```typescript
const maybeUser = createRetry(
  async () => fetchUserOrThrow(),
  {
    maxRetries: 2,
    onError: () => {
      // resolve to undefined instead of throwing
    },
  },
);

const user = await maybeUser();
```

## Reference

| Export | Meaning |
| --- | --- |
| `createRetry(fn, options)` | Wrap `fn` with retries |
| `InvalidRetryError` | Thrown for bad options |
