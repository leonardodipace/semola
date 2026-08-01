---
title: Workflow
description: Durable multi-step jobs on Redis with resumable steps
---

Workflows run multi-step processes that survive restarts. Each named `step` caches its result in Redis, so a resume skips work that already succeeded.

```typescript
import {
  defineWorkflow,
  listWorkflows,
  resumeWorkflow,
} from "semola/workflow";
```

Needs a `Bun.RedisClient`. Workflow names must be unique in the process. Execution IDs must be unique across all workflows sharing a Redis database.

## Define and start

```typescript
const fulfillOrder = defineWorkflow<{ orderId: string }, string>({
  name: "fulfill-order",
  redis: redisClient,
  handler: async ({ input, executionId, signal, step }) => {
    const payment = await step("charge", async () => {
      return charge(input.orderId);
    });

    await step("ship", async () => {
      await ship(payment.orderId);
    });

    return "done";
  },
});

const { executionId, status } = await fulfillOrder.start({
  orderId: "ord_123",
});
// status is "pending" - work runs in the background
```

`start` enqueues an execution and returns immediately. Poll status with `get`:

```typescript
const execution = await fulfillOrder.get(executionId);

if (execution.status === "completed") {
  console.log(execution.result);
}
```

Statuses: `pending`, `running`, `completed`, `failed`, `cancelled`.

`start(input, options?)` also accepts `executionId` and `partitionKey`.

## Steps

```typescript
await step("name", async ({ input, signal, fail }) => {
  // return a value - cached for resume
  return value;
});
```

On resume, completed steps are not re-run. Call `fail(message)` to skip retries and fail the workflow immediately. Keep step handlers idempotent: side effects may run more than once during retries.

## Control an execution

```typescript
await fulfillOrder.resume(executionId);
await fulfillOrder.cancel(executionId);
await fulfillOrder.stop(); // stop this workflow's workers
```

Across workflows in the same process:

```typescript
const pending = await listWorkflows(redisClient, {
  status: "pending",
});

await resumeWorkflow(redisClient, executionId);
```

## Partitions

Use `partitionBy` (or `start({ partitionKey })`) so `concurrency` also caps how many executions with the same key may run at once across all replicas. That Redis-wide per-key cap is accurate only when every replica uses the same `concurrency` value; if replicas differ, the effective cap is the maximum configured value.

```typescript
const deploy = defineWorkflow<{ cloudEnvironmentId: string }>({
  name: "deploy",
  redis: redisClient,
  concurrency: 3,
  partitionBy: (input) => input.cloudEnvironmentId,
  handler: async ({ step }) => {
    await step("apply", async () => {
      // at most 3 deploys per cloudEnvironmentId at once
    });
  },
});
```

`partitionKey` on `start` overrides `partitionBy` when both are present. Empty keys throw. The resolved key is stored on execution meta so `resume` keeps the original partition.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | required | Redis meta + process registration |
| `redis` | required | `Bun.RedisClient` |
| `handler` | required | Workflow function with `step` helper |
| `concurrency` | `1` | Parallel workers; with partitions, also max concurrent per key |
| `partitionBy` | - | `(input) => string` partition key at `start()` |
| `retries` | `3` | Step retry attempts before `failed` (`0` = fail immediately) |
| `retryBackoff` | 1s base, 2x, 30s cap | Exponential backoff |
| `pollInterval` | `100` | Idle poll delay in ms |
| `lockTTL` | `300000` | Execution lock TTL (also partition slot TTL) |
| `hooks` | - | Lifecycle callbacks (`onStart`, `onRetry`, `onError`, `onComplete`, `onCancel`) |
| serializers | - | Optional input / result / step output (de)serializers |

## Errors you can catch

These are exported from `semola/workflow`:

`WorkflowError`, `NotFoundError`, `StateError`, `SerializationError`, `ExecutionError`, `LockError`, `CancelledError`.
