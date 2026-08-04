# Workflow

Durable and resumable workflows backed by Redis.

## Import

```typescript
import {
  defineWorkflow,
  listWorkflows,
  recoverOrphanedWorkflows,
  resumeWorkflow,
} from "semola/workflow";
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

- calling `resume(executionId)`, `resumeWorkflow(redis, executionId)`, or automatic recovery reruns the handler
- completed steps are loaded from Redis and skipped
- execution continues from the first unfinished step

Before a step runs, a start marker is written. If the process dies mid-step, resume sees the marker without an output and re-runs that step (at-least-once).

## Crash Recovery

`defineWorkflow` registers the handler in a process-local map by `name`. By default, each workflow also runs a recovery sweeper every `recoveryIntervalMs` (30000). Set `recoveryIntervalMs: 0` to disable.

You can also recover on boot (or from ops) after all workflow modules are loaded:

```typescript
await recoverOrphanedWorkflows(redis);
// or scoped: await recoverOrphanedWorkflows(redis, { name: "onboard-user" });
```

`recoverOrphanedWorkflows`:

1. Reclaims ids stuck on the per-workflow `processing` list when no lock is held and status is `pending` or `running`
2. Scans unlocked `pending` / `running` executions (same rules as `listWorkflows` + `resumeWorkflow`)

Notes:

- Orphaned `running` executions (process died, lock TTL expired) are included once the lock is gone.
- Failed executions are not auto-resumed - those exhausted retries for a reason.
- Default `lockTTL` is 5 minutes. Recovery immediately after a crash may still see locks; the sweeper retries on its interval.
- Handlers must be defined (imported) before recovery. An unknown `name` in Redis throws `NotFoundError` from `resumeWorkflow`.

## Job claim

Workers claim work with `RPOPLPUSH` from `workflow:{name}:jobs` onto `workflow:{name}:processing`. After the claim attempt finishes (success, failure, lock contention, or partition requeue), the id is removed from `processing` with `LREM`.

If a process dies after claim and before ack, the id stays on `processing` until recovery reclaims it. This avoids losing work to a bare `RPOP`.

## API

### Instance methods

- `start(input, options?)` persists and enqueues a new execution on a Redis list, then returns its ID with `pending` status.
- `resume(executionId)` enqueues a failed or interrupted execution, then returns its ID with `pending` status.
- `get(executionId)` returns execution status, timestamps, and completed steps.
- `cancel(executionId)` marks execution as cancelled.
- `stop()` stops worker loops and the recovery sweeper, then waits for in-flight executions to finish.
- `name` - workflow name used for registration and Redis meta.

### Top-level helpers

- `listWorkflows(redis, options?)` scans all executions. Options: `name`, `status`, `unlockedOnly`.
- `resumeWorkflow(redis, executionId)` reads the stored workflow name and resumes via the process registry.
- `recoverOrphanedWorkflows(redis, options?)` reclaims processing orphans and resumes unlocked `pending` / `running` executions. Options: `name`.

`start()`, `resume()`, and `resumeWorkflow()` enqueue work for background workers. Use `get(executionId)` to read the eventual result or failure.

Workers are per process. With multiple replicas, each process runs up to `concurrency` executions; Redis distributes jobs across them. Total parallelism is roughly the sum of each process's concurrency.

With `partitionBy` / `start({ partitionKey })`, `partitionConcurrency` (defaulting to `concurrency`) caps how many executions with the same key may run at once across all replicas. Keep `partitionConcurrency` identical on every replica; worker `concurrency` may differ per process.

## Options

- **`name`** (required) - Workflow name stored in Redis meta and used for process registration. Must be unique in the process. Execution IDs must be unique across all workflows sharing a Redis database.
- **`redis`** (required) - Bun Redis client instance
- **`handler`** (required) - Workflow function with `step` helper
- **`concurrency`** - Parallel workers in this process (default: 1)
- **`partitionConcurrency`** - Max concurrent executions per partition key across Redis (default: same as `concurrency`). Prefer setting this explicitly when worker `concurrency` varies by replica.
- **`partitionBy`** - Optional `(input) => string` to derive a partition key at `start()`. Empty keys throw.
- **`pollInterval`** - Milliseconds to wait when the job list is empty (default: 100)
- **`recoveryIntervalMs`** - Automatic orphan recovery interval (default: 30000). Set to `0` to disable.
- **`retries`** - Step retry attempts before marking the workflow `failed` (default: 3). Set to `0` to fail on the first error with no retries.
- **`retryBackoff`** - Optional `{ baseDelay, multiplier, maxDelay }` for retry delays (defaults: 1000ms, 2x, 30000ms cap)
- **`hooks`** - Optional lifecycle callbacks (see [Hooks](#hooks))
- **`lockTTL`** - Execution lock TTL in milliseconds (default: 300000). Also used as partition slot TTL.
- **`serializeInput`**, **`deserializeInput`**, **`serializeResult`**, **`deserializeResult`**, **`serializeStepOutput`**, **`deserializeStepOutput`** - Custom serializers for Redis persistence

`start(input, options?)` accepts `executionId` and `partitionKey`. `partitionKey` overrides `partitionBy` when both are present. The resolved key is stored on execution meta so `resume` keeps the original partition.

## Redis Keys

Executions use flat keys keyed only by execution id:

- `workflow:execution:{id}:meta`
- `workflow:execution:{id}:steps`
- `workflow:execution:{id}:lock`

Pending and in-flight work for a workflow name:

- `workflow:{name}:jobs`
- `workflow:{name}:processing`

Per-partition concurrency uses one Redis string per slot (`0` .. `partitionConcurrency - 1`):

- `workflow:{name}:partition:{key}:{slot}`

Slots are claimed with `SET NX PX` (same pattern as execution locks). Crash recovery relies on TTL plus the recovery sweeper.

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

### Partition example

```typescript
const deploy = defineWorkflow<{ cloudEnvironmentId: string }>({
  name: "deploy",
  redis: redisClient,
  concurrency: 8,
  partitionConcurrency: 3,
  partitionBy: (input) => input.cloudEnvironmentId,
  handler: async ({ step }) => {
    await step("apply", async () => {
      // at most 3 deploys per cloudEnvironmentId at once
    });
  },
});

// or override / set key at start time
await deploy.start(input, { partitionKey: input.cloudEnvironmentId });
```

## Retries

Failed steps retry automatically with exponential backoff before the workflow is marked `failed`. By default, each step gets 3 retries (4 total attempts). This applies to every workflow unless you override `retries`.

Call `fail(message)` inside a step to skip retries and fail the workflow immediately:

```typescript
handler: async ({ step }) => {
  await step("charge", async ({ input, fail }) => {
    if (!input.cardId) {
      fail("missing card");
    }
  });
},
```

Step handlers receive `{ input, signal, fail }`.

A start marker is written before each attempt. Only successful step runs persist an output. Side effects inside a step may run more than once during retries or after a crash mid-step, so keep step handlers idempotent.

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
- `onError` runs when a step fails after all retries are exhausted, or immediately after `fail()`.
- `onComplete` runs after a successful execution.
- `onCancel` runs when execution ends as cancelled.

## Redis durability

Workflow state lives entirely in Redis. Treat Redis as the system of record:

- Enable AOF (`appendonly yes`). Prefer `appendfsync everysec` (or `always` if you accept the latency).
- Run Redis with replication / HA appropriate for your RPO.
- Back up Redis regularly. Losing Redis without durable persistence loses workflow state.

## Determinism

On resume, the full handler re-runs and skips steps that already have an output. Keep step names stable and unique. Avoid non-deterministic branching between steps (wall-clock, random, external reads outside `step`) unless those branches remain safe when replayed.

## Notes

- Step names should be stable and unique inside a workflow handler.
- Semantics are at-least-once for side effects (not exactly-once).
- Keep step handlers idempotent whenever possible.
- Duplicate `defineWorkflow({ name })` in the same process throws.
- Not included: durable timers/sleep, signals, child workflows, or event-history replay like Temporal.
