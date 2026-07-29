---
title: Extra
description: Small helpers that do not need their own package
---

Odds and ends that are useful but too small for a dedicated module.

```typescript
import { createRetry } from "semola/extra";
```

## Retry with jitter

Wrap an async function so transient failures retry with full-jitter backoff (about 1s base, capped at 60s):

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

const user = await fetchUser("123");
```

Options: `maxRetries`, optional `id`, `onError`, `onFailedAttempt`, `retryOnError` (return `false` to stop retrying a given error).

Invalid config throws `InvalidRetryError` (also exported from `semola/extra`).
