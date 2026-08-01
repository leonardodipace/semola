---
title: Queue
description: Redis-backed background jobs with retries and concurrency
---

Run work in the background with Redis. Jobs are JSON-serialized, polled by workers, and retried with backoff when they fail.

```typescript
import { Queue } from "semola/queue";
```

Needs a `Bun.RedisClient`.

## Basic usage

```typescript
type EmailJob = {
  to: string;
  subject: string;
};

const emails = new Queue<EmailJob>({
  name: "emails",
  redis: redisClient,
  concurrency: 4,
  retries: 3,
  handler: async (data, signal) => {
    await sendEmail(data.to, data.subject);
  },
});

const jobId = await emails.enqueue({
  to: "user@example.com",
  subject: "Welcome",
});

// later, when shutting down:
await emails.stop();
```

Workers start as soon as you construct the queue. `enqueue` returns a job id. Failed jobs retry until `retries` is exhausted, then land on a dead-letter list (`queue:{name}:dead-letter`).

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | required | Redis key namespace |
| `redis` | required | `Bun.RedisClient` |
| `handler` | required | `(data, signal?) => void \| Promise<void>` |
| `retries` | `3` | Max attempts after the first failure |
| `retryBackoff` | `baseDelay` 1s, `multiplier` 2, `maxDelay` 60s | Exponential backoff |
| `timeout` | `30000` | Per-job timeout in ms |
| `concurrency` | `1` | Parallel workers |
| `pollInterval` | `100` | Idle poll delay in ms |
| `onSuccess` | - | After a successful job |
| `onRetry` | - | Before a retry |
| `onError` | - | When retries are exhausted |
| `onParseError` | - | When a Redis payload cannot be parsed |

Use `signal` in the handler to abort work when the job times out or the queue stops.

## Shutdown

```typescript
await emails.stop();
```

Stops polling and waits for in-flight handlers to finish.
