# Workflow

Durable and resumable workflows backed by Redis.

## Import

```typescript
import { defineWorkflow, listWorkflows, resumeWorkflow } from "semola/workflow";
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

// start() enqueues work for background workers, so this is initially pending
let execution = await onboardUser.get(started.executionId);

while (execution.status === "pending" || execution.status === "running") {
  await Bun.sleep(1000);
  execution = await onboardUser.get(started.executionId);
}
```

## Why It Is Durable

Each step persists its output in Redis using the step name as key.

If a workflow crashes after one or more completed steps:

- calling `resume(executionId)` or `resumeWorkflow(redis, executionId)` reruns the handler
- completed steps are loaded from Redis and skipped
- execution continues from the first unfinished step

## Crash Recovery

`defineWorkflow` registers the handler in a process-local map by `name`. On boot, after all workflow modules are loaded:

```typescript
const pending = await listWorkflows(redis, {
  status: ["pending", "running"],
  unlockedOnly: true,
});

for (const item of pending) {
  await resumeWorkflow(redis, item.id);
}
```

- `unlockedOnly: true` skips executions that still hold a Redis lock (another worker is alive).
- Orphaned `running` executions (process died, lock TTL expired) are included.
- Do not auto-resume all `failed` executions - those exhausted retries for a reason. Pass `status: "failed"` only when you intend to retry them.
- Default `lockTTL` is 5 minutes. Recovery immediately after a crash may still see locks; wait or run the loop periodically.
- Handlers must be defined (imported) before `resumeWorkflow`. An unknown `name` in Redis throws `NotFoundError`.

## API

### Instance methods

- `start(input, options?)` persists and enqueues a new execution on a Redis list, then returns its ID with `pending` status.
- `resume(executionId)` enqueues a failed or interrupted execution, then returns its ID with `pending` status.
- `get(executionId)` returns execution status, timestamps, and completed steps.
- `cancel(executionId)` marks execution as cancelled.
- `stop()` stops worker loops and waits for in-flight executions to finish.
- `name` - workflow name used for registration and Redis meta.

### Top-level helpers

- `listWorkflows(redis, options?)` scans all executions. Options: `name`, `status`, `unlockedOnly`.
- `resumeWorkflow(redis, executionId)` reads the stored workflow name and resumes via the process registry.

`start()`, `resume()`, and `resumeWorkflow()` enqueue work for background workers. Use `get(executionId)` to read the eventual result or failure.

Workers are per process. With multiple replicas, each process runs up to `concurrency` executions; Redis distributes jobs across them. Total parallelism is roughly the sum of each process's concurrency.

## Options

- **`name`** (required) - Workflow name stored in Redis meta and used for process registration. Must be unique in the process. Execution IDs must be unique across all workflows sharing a Redis database.
- **`redis`** (required) - Bun Redis client instance
- **`handler`** (required) - Workflow function with `step` helper
- **`concurrency`** - Number of parallel workers in this process (default: 1)
- **`pollInterval`** - Milliseconds to wait when the job list is empty (default: 100)
- **`retries`** - Step retry attempts before marking the workflow `failed` (default: 3). Set to `0` to fail on the first error with no retries.
- **`retryBackoff`** - Optional `{ baseDelay, multiplier, maxDelay }` for retry delays (defaults: 1000ms, 2x, 30000ms cap)
- **`hooks`** - Optional lifecycle callbacks (see [Hooks](#hooks))
- **`lockTTL`** - Execution lock TTL in milliseconds (default: 300000)
- **`serializeInput`**, **`deserializeInput`**, **`serializeResult`**, **`deserializeResult`**, **`serializeStepOutput`**, **`deserializeStepOutput`** - Custom serializers for Redis persistence

## Redis Keys

Executions use flat keys keyed only by execution id:

- `workflow:execution:{id}:meta`
- `workflow:execution:{id}:steps`
- `workflow:execution:{id}:lock`

Pending work for a workflow name uses a Redis list:

- `workflow:{name}:jobs`

The workflow `name` is also stored as a field on the meta hash (not in the execution key path).

### Concurrency example

```typescript
const onboardUser = defineWorkflow<User>({
  name: "onboard-user",
  redis: redisClient,
  concurrency: 3,
  handler: async ({ input, step }) => {
    await step("send-email", async () => {
      await emailClient.send(input.email, "Welcome!");
    });
  },
});
```

## Retries

Failed steps retry automatically with exponential backoff before the workflow is marked `failed`. By default, each step gets 3 retries (4 total attempts). This applies to every workflow unless you override `retries`.

Only successful step runs are persisted to Redis. Side effects inside a step may run more than once during retries, so keep step handlers idempotent.

`cancel(executionId)` works during retry backoff as well as between steps.

After retries are exhausted, call `resume(executionId)` or `resumeWorkflow(redis, executionId)` to re-run the handler from the first unfinished step.

### Disable retries

```typescript
const strictWorkflow = defineWorkflow<User>({
  name: "strict",
  redis: redisClient,
  retries: 0,
  handler: async ({ step }) => {
    await step("send-email", async () => {
      await emailClient.send(...);
    });
  },
});
```

### Custom backoff

```typescript
const onboardUser = defineWorkflow<User>({
  name: "onboard-user",
  redis: redisClient,
  retries: 3,
  retryBackoff: {
    baseDelay: 500,
    multiplier: 2,
    maxDelay: 10000,
  },
  handler: async ({ step }) => {
    await step("send-email", async () => {
      await emailClient.send(...);
    });
  },
});
```

## Hooks

Lifecycle hooks are optional callbacks on the workflow definition. Use them for logging, metrics, or alerting. Errors thrown inside a hook do not fail the workflow.

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

- `onStart` runs each time the handler executes, including on `resume()`.
- `onRetry` runs before each step retry backoff delay.
- `onError` runs when a step fails after all retries are exhausted.
- `onComplete` runs after a successful execution.
- `onCancel` runs when execution ends as cancelled.

## Notes

- Step names should be stable and unique inside a workflow handler.
- Semantics are at-least-once for side effects.
- Keep step handlers idempotent whenever possible.
- Duplicate `defineWorkflow({ name })` in the same process throws.
