---
title: Workflow
description: Durable multi-step jobs on Redis with resumable steps
---

Workflows run multi-step processes that survive restarts. Each named `step` caches its result in Redis, so a resume skips work that already succeeded.

Needs a `Bun.RedisClient`. Workflow names must be unique in the process. Execution IDs must be unique across all workflows sharing a Redis database.

## Import

```typescript
import {
  defineWorkflow,
  listWorkflows,
  resumeWorkflow,
} from "semola/workflow";
```

## Quick start

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

### Resume semantics

On resume, completed steps are not re-run. Keep step handlers idempotent: side effects may run more than once during retries.

### Fail without retry

Call `fail(message)` to skip retries and fail the workflow immediately (`StepFailedError`).

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

## Examples

### Example: Resume after crash

```typescript
const sync = defineWorkflow<{ accountId: string }>({
  name: "account-sync",
  redis: redisClient,
  handler: async ({ input, step }) => {
    const data = await step("fetch", async () => fetchRemote(input.accountId));
    await step("write", async () => persist(data));
  },
});

const { executionId } = await sync.start({ accountId: "acc_1" });

// process dies mid-run… later:
await sync.resume(executionId);
```

### Example: Fail a step permanently

```typescript
await step("validate", async ({ fail }) => {
  if (!isValid(order)) {
    fail("invalid order");
  }

  return order;
});
```

### Example: Partitioned deploys

```typescript
const deploy = defineWorkflow<{ envId: string }>({
  name: "deploy",
  redis: redisClient,
  concurrency: 2,
  partitionBy: (input) => input.envId,
  handler: async ({ step }) => {
    await step("apply", async () => applyInfra());
  },
});

await deploy.start({ envId: "prod" });
await deploy.start({ envId: "prod" }); // queued behind the first for this key
```

### Example: Lifecycle hooks

```typescript
const job = defineWorkflow({
  name: "report",
  redis: redisClient,
  hooks: {
    onStart: ({ executionId }) => console.log("start", executionId),
    onRetry: ({ executionId, attempt }) => console.warn(executionId, attempt),
    onError: ({ executionId, error }) => console.error(executionId, error),
    onComplete: ({ executionId }) => console.log("done", executionId),
    onCancel: ({ executionId }) => console.log("cancelled", executionId),
  },
  handler: async ({ step }) => {
    await step("run", async () => buildReport());
  },
});
```

## Reference

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
| `hooks` | - | `onStart`, `onRetry`, `onError`, `onComplete`, `onCancel` |
| serializers | - | Optional input / result / step output (de)serializers |

### Instance methods

| Method | Meaning |
| --- | --- |
| `start(input, options?)` | Enqueue; options: `executionId`, `partitionKey` |
| `get(executionId)` | Read execution status / result |
| `resume(executionId)` | Continue a failed or interrupted run |
| `cancel(executionId)` | Cancel an execution |
| `stop()` | Stop this workflow's workers (waits up to `lockTTL`) |

### Process helpers

| Function | Meaning |
| --- | --- |
| `listWorkflows(redis, filters?)` | List executions (`name`, `status`, `unlockedOnly`) |
| `resumeWorkflow(redis, executionId)` | Resume by id (workflow must be registered) |
| `clearWorkflowRegistry()` | Clear the in-process registry |

## Errors

Exported from `semola/workflow`:

`WorkflowError`, `NotFoundError`, `StateError`, `SerializationError`, `ExecutionError`, `LockError`, `PartitionError`, `CancelledError`, `StepFailedError`.
