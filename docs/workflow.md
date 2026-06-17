# Workflow

Durable and resumable workflows backed by Redis.

## Import

```typescript
import { defineWorkflow } from "semola/workflow";
```

## Basic Usage

```typescript
type User = {
  id: number;
  email: string;
};

const onboardUser = defineWorkflow<User>({
  name: "onboard-user",
  redis: redisClient,
  handler: async ({ input, step }) => {
    const user = await step("get-user-from-db", async () => {
      return db.users.getById(input.id);
    });

    await step("send-email", async () => {
      await emailClient.send(input.email, `Welcome, ${user.fullName}!`);
    });
  },
});

const started = await onboardUser.start({
  id: 1,
  email: "leo@example.com",
});
```

## Why It Is Durable

Each step persists its output in Redis using the step name as key.

If a workflow crashes after one or more completed steps:

- calling `resume(executionId)` reruns the handler
- completed steps are loaded from Redis and skipped
- execution continues from the first unfinished step

## API

- `start(input, options?)` starts a new execution and runs inline.
- `run(input, options?)` starts and returns the typed workflow result.
- `resume(executionId)` resumes a failed or interrupted execution.
- `get(executionId)` returns execution status, timestamps, and completed steps.
- `cancel(executionId)` marks execution as cancelled.

## Retries

Failed steps retry automatically with exponential backoff before the workflow is marked `failed`. The default is 3 retries (4 total attempts per step).

```typescript
const onboardUser = defineWorkflow<User>({
  name: "onboard-user",
  redis: redisClient,
  retries: 3,
  handler: async ({ step }) => {
    await step("send-email", async () => {
      await emailClient.send(...);
    });
  },
});
```

Backoff delays start at 1000ms and double each retry, capped at 30000ms. Override with `retryBackoff` when needed. Only successful step runs are persisted to Redis. Side effects inside a step may run more than once during retries, so keep step handlers idempotent.

After retries are exhausted, call `resume(executionId)` to re-run the handler from the first unfinished step.

## Hooks

Lifecycle hooks are optional callbacks on the workflow definition:

```typescript
const onboardUser = defineWorkflow<User, void>({
  name: "onboard-user",
  redis: redisClient,
  hooks: {
    onStart: ({ executionId, input }) => { ... },
    onRetry: ({ stepName, error, attempt, nextRetryDelayMs, retriesRemaining }) => { ... },
    onError: ({ stepName, error, totalAttempts, errorHistory }) => { ... },
    onComplete: ({ executionId, input, result }) => { ... },
    onCancel: ({ executionId, input }) => { ... },
  },
  handler: async ({ step }) => { ... },
});
```

- `onStart` runs when execution status becomes `running`.
- `onRetry` runs before each step retry backoff delay.
- `onError` runs when a step fails after all retries are exhausted.
- `onComplete` runs after a successful execution.
- `onCancel` runs when execution is cancelled.

## Notes

- Step names should be stable and unique inside a workflow handler.
- Semantics are at-least-once for side effects.
- Keep step handlers idempotent whenever possible.
