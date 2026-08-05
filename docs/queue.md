---
title: Queue
description: Redis-backed background jobs with retries and concurrency
---

Run work in the background with Redis. Jobs are JSON-serialized, polled by workers, and retried with backoff when they fail.

Needs a `Bun.RedisClient`.

## Import

```typescript
import { Queue } from "semola/queue";
```

## Quick start

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

Workers start as soon as you construct the queue. `enqueue` returns a job id.

## Retries and timeouts

Failed jobs retry until `retries` is exhausted, then land on a dead-letter list (`queue:{name}:dead-letter`).

Use `signal` in the handler to abort work when the job times out (default 30s).

### Hooks

```typescript
const emails = new Queue<EmailJob>({
  name: "emails",
  redis: redisClient,
  handler: async (data) => {
    await sendEmail(data.to, data.subject);
  },
  onSuccess: (job) => console.log("sent", job.data.to),
  onRetry: ({ job, error, retriesRemaining }) => {
    console.warn("retry", job.id, error, retriesRemaining);
  },
  onError: ({ job, lastError }) => {
    console.error("dead letter", job.data, lastError);
  },
  onParseError: ({ rawJobData, parseError }) => {
    console.error("bad payload", rawJobData, parseError);
  },
});
```

## Shutdown

```typescript
await emails.stop();
```

Stops polling and waits for in-flight handlers to finish. In-flight pops are re-queued.

## Examples

### Example: Low concurrency, many retries

```typescript
const invoices = new Queue({
  name: "invoices",
  redis: redisClient,
  concurrency: 1,
  retries: 10,
  retryBackoff: {
    baseDelay: 2_000,
    multiplier: 2,
    maxDelay: 120_000,
  },
  handler: async (data) => {
    await chargeInvoice(data.invoiceId);
  },
});
```

### Example: Abort on timeout

```typescript
const downloads = new Queue<{ url: string }>({
  name: "downloads",
  redis: redisClient,
  timeout: 10_000,
  handler: async (data, signal) => {
    const res = await fetch(data.url, { signal });
    await save(await res.arrayBuffer());
  },
});
```

### Example: Dead-letter logging

```typescript
const jobs = new Queue({
  name: "webhooks",
  redis: redisClient,
  retries: 2,
  handler: async (data) => {
    await deliverWebhook(data);
  },
  onError: async ({ job, lastError }) => {
    await alertOps("webhook dead-lettered", {
      data: job.data,
      error: lastError,
    });
  },
});
```

### Example: Graceful process exit

```typescript
process.on("SIGINT", async () => {
  await emails.stop();
  process.exit(0);
});
```

## Reference

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

### Methods

| Method | Meaning |
| --- | --- |
| `enqueue(data)` | Push a job; returns job id |
| `stop()` | Stop workers and drain in-flight work |

Redis keys: `queue:{name}:jobs`, `queue:{name}:dead-letter`.
