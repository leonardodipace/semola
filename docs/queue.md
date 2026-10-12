---
title: Queue
description: Redis-backed background jobs with retries and concurrency
---

Run work in the background with Redis. Jobs are JSON-serialized, polled by workers, and retried with backoff when they fail.

Delivery is **at-least-once**: a worker crash or visibility expiry can run the same job again. Handlers should be **idempotent**.

Needs a `Bun.RedisClient`.

## Import

```typescript
import { Queue } from "semola/queue";
```

## Quick start

Constructing the queue starts four workers. `enqueue()` stores the email job in Redis, and `stop()` later drains active work before shutdown.

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

Failed jobs retry until `retries` is exhausted, then call `onError`. Backoff delays live in Redis (`queue:{name}:retry`), not in-process timers, so retries survive worker restarts. Malformed Redis payloads land on the dead-letter list (`queue:{name}:dead-letter`) and call `onParseError`.

Use `signal` in the handler to abort work when the job times out (default 30s).

**Visibility vs timeout:** On claim, the job moves to an in-flight ZSET with score `now + visibilityTimeoutMs` (default `max(timeout * 2, 60_000)`). If the handler does not finish and ack before that deadline, the job is reclaimed to the ready list and may run again. Long-running work needs a higher `visibilityTimeoutMs` or you accept reclaim/redelivery. There is no lease renewal API in v1.

### Hooks

These hooks report successful jobs, retries, exhausted retries, and malformed Redis payloads at their corresponding lifecycle points.

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
    console.error("dead letter", job.id, lastError);
  },
  onParseError: ({ parseError }) => {
    console.error("bad payload", parseError);
  },
});
```

## Shutdown

`stop()` stops claiming new work, releases any claim that never reached the handler back to the ready list, and waits for active handlers (each acks success or failure in Redis).

```typescript
await emails.stop();
```

## Examples

### Add work with `enqueue()`

`enqueue()` JSON-serializes a job, pushes it to Redis, and returns its generated ID.

```typescript
const jobId = await emails.enqueue({
  to: "user@example.com",
  subject: "Welcome",
});
```

### Low concurrency, many retries

One worker processes invoices serially, retrying failures with capped exponential backoff.

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

### Abort on timeout

After ten seconds, the queue aborts the handler's signal, which also cancels the in-flight fetch.

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

### Exhausted retry logging

After two retries are exhausted, `onError` alerts operators. Handler failures are not added to the parse-failure dead-letter list.

```typescript
const jobs = new Queue({
  name: "webhooks",
  redis: redisClient,
  retries: 2,
  handler: async (data) => {
    await deliverWebhook(data);
  },
  onError: async ({ job, lastError }) => {
    await alertOps("webhook failed", {
      jobId: job.id,
      error: lastError,
    });
  },
});
```

### Graceful process exit

The signal handler waits for `stop()` to drain active jobs before ending the process.

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
| `visibilityTimeoutMs` | `max(timeout * 2, 60000)` | In-flight reclaim deadline on claim |
| `reclaimBatchSize` | `32` | Max jobs promoted/reclaimed per worker tick |
| `onSuccess` | - | After a successful job |
| `onRetry` | - | Before a retry |
| `onError` | - | When retries are exhausted |
| `onParseError` | - | When a Redis payload cannot be parsed |

### Methods

| Method | Meaning |
| --- | --- |
| `enqueue(data)` | Push a job; returns job id |
| `stop()` | Stop workers and drain in-flight work |

Redis keys (observability): `queue:{name}:jobs` (ready LIST), `queue:{name}:inflight` (claimed ZSET, score = visibility deadline ms), `queue:{name}:retry` (backoff ZSET, score = due ms), `queue:{name}:dead-letter` (malformed payloads).
