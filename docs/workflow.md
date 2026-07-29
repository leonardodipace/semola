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

Needs a `Bun.RedisClient`. Workflow names must be unique in the process.

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
// status is "pending" — work runs in the background
```

`start` enqueues an execution and returns immediately. Poll status with `get`:

```typescript
const execution = await fulfillOrder.get(executionId);

if (execution.status === "completed") {
  console.log(execution.result);
}
```

Statuses: `pending`, `running`, `completed`, `failed`, `cancelled`.

## Steps

```typescript
await step("name", async (input, signal) => {
  // return a value — cached for resume
  return value;
});
```

The step callback receives the workflow input and an `AbortSignal`. On resume, completed steps are not re-run.

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

## Options

Same family as queues: `retries`, `retryBackoff`, `concurrency`, `pollInterval`, plus `lockTTL`, lifecycle `hooks`, and optional serializers for input / result / step output.

## Errors you can catch

These are exported from `semola/workflow`:

`WorkflowError`, `NotFoundError`, `StateError`, `SerializationError`, `ExecutionError`, `LockError`, `CancelledError`.
