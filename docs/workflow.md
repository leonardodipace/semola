---
title: Workflow
description: Durable multi-step jobs on Redis with resumable steps
---

Durable workflows on Redis. Event history, deterministic replay, inline steps, multi-replica leases, and automatic orphan recovery.
Workflows run multi-step processes that survive restarts. Each named `step` caches its result in Redis, so replay and reclaim skip work that already succeeded.

Needs a `Bun.RedisClient`. Workflow names must be unique in the process. Execution IDs must be unique per workflow name (Redis keys are `workflow:{name}:…`).

## Import

```typescript
import {
  defineWorkflow,
  listWorkflows,
  NotFoundError,
  type WorkflowExecution,
} from "semola/workflow";
```

Also exported: `DuplicateWorkflowError`, `NonRetryableStepError`, `SerializationError`, `WorkflowStoreError`, and the public workflow types (`Workflow`, `WorkflowOptions`, hooks/status/start/cancel shapes, `WorkflowListItem`, etc.).

## Quick start

This registers embedded workers, starts one execution, then reads its current status. During replay, completed named steps are loaded from Redis instead of running again.

```typescript
const onboard = defineWorkflow<{ userId: string }, { ok: true }>({
  name: "onboard-user",
  redis: redisClient,
  handler: async ({ input, step, sleep }) => {
    await step("send-email", async () => {
      await emailClient.send(input.userId);
    });

    await sleep(1000);

    await step("provision", async () => {
      await provision(input.userId);
    });

    return { ok: true };
  },
});

const { executionId } = await onboard.start({ userId: "u_1" });
const execution = await onboard.get(executionId);
```

`start()` enqueues work for embedded workers and returns `pending`. Poll `get(executionId)` for the eventual result. Call `stop()` on shutdown.

## Durability model

Each execution has an append-only event history in Redis. A single lease owner advances the workflow by:

1. Loading history
2. Replaying the workflow function from the start
3. Resolving completed `step` / `sleep` calls from history (no side effects)
4. Running the next incomplete step **inline** under the same lease, or scheduling a durable timer, or completing / failing / cancelling

Side effects belong inside `step`. Workflow code outside `step` / `sleep` must be deterministic relative to history: no raw `Date.now()`, `Math.random()`, network, or unseeded nondeterminism.

Steps are **at-least-once**. `step` bodies must be idempotent; a crash mid-step may re-run the handler. Input, result, and step outputs are always JSON (`JSON.stringify` / `JSON.parse`).

## Multi-replica and automatic recovery

N Bun processes may register the same workflow `name` against the same Redis. Work is distributed via one task queue and per-execution leases (`lockTTL`).

If a replica dies mid-run, lease expiry lets another replica (or the same process after restart) reclaim the execution. Reclaim also drops leases with no TTL (`PTTL -1`) so a bad `SET` cannot pin an execution forever. You do not need to call `resume()` for crash recovery; workers reclaim from Redis automatically.

History and status writes are lease-fenced (Redis compare-and-append / compare-and-set against the lease token). A writer that loses the lease cannot append; the new owner continues from history. Client paths (`start` / cancel / resume) append without a lease.

`resume(executionId)` re-queues a **failed** execution: persist keys, append a resume event, re-schedule failed steps, then mark active. It also finishes an interrupted resume (`pending` after persist, or after resume events but before active). Plain `pending` / `running` / `completed` / `cancelled` executions reject. A later failure needs a new resume event even if an older `WorkflowResumed` is already in history.

## Examples

### Start and inspect an execution

`start()` enqueues work and immediately returns `pending`. Pass a custom `executionId` when you want a stable key (non-empty, no `:`). Poll `get()` for the terminal result.

```typescript
const { executionId, status } = await onboard.start(
  { userId: "u_1" },
  { executionId: "onboard-u_1" },
);
// status: "pending"

let execution = await onboard.get(executionId);

while (execution.status === "pending" || execution.status === "running") {
  await Bun.sleep(100);
  execution = await onboard.get(executionId);
}

console.log(execution.status, execution.result, execution.error);
console.log(execution.steps);
// steps: { name, completedAt }[] - return values stay in history, not on get()
```

### Cancel an execution

`cancel()` records the request and aborts local work. The return value may still be `pending` or `running`; poll until status is `cancelled`.

```typescript
const requested = await onboard.cancel(executionId);
console.log(requested.status);

let execution = await onboard.get(executionId);

while (execution.status !== "cancelled") {
  await Bun.sleep(100);
  execution = await onboard.get(executionId);
}

console.log(execution.cancelledAt);
```

### Resume a failed execution

`resume()` re-queues a failed execution and returns `pending`. Completed steps stay cached and are not repeated. Non-failed statuses reject unless an interrupted resume is already in progress.

```typescript
const execution = await onboard.get(executionId);

if (execution.status === "failed") {
  const resumed = await onboard.resume(executionId);
  console.log(resumed.status); // "pending"
}
```

### List executions

`listWorkflows()` scans executions without requiring a registered workflow instance. Filter by workflow name, status, or both (scalars or arrays).

```typescript
const active = await listWorkflows(redisClient, {
  status: ["pending", "running"],
});

const failed = await listWorkflows(redisClient, {
  name: "onboard-user",
  status: "failed",
});

for (const item of failed) {
  await onboard.resume(item.id);
}
```

Results are lightweight `WorkflowListItem` snapshots. Use instance `get()` for input, result, error, and step details. Filter `name` with a string or string array; resume through the matching workflow instance.

### Fail without retrying

Call `fail()` inside a step for a non-retryable failure.

```typescript
const payment = defineWorkflow<{ orderId: string }, { charged: true }>({
  name: "charge-order",
  redis: redisClient,
  handler: async ({ input, step }) => {
    await step("charge", async ({ fail }) => {
      const charged = await charge(input.orderId);

      if (!charged) {
        fail("card declined");
      }
    });

    return { charged: true };
  },
});
```

### Observe retries and completion

Hooks observe real lifecycle transitions. Hook errors do not fail the workflow.

```typescript
const sync = defineWorkflow<{ accountId: string }, { synced: true }>({
  name: "sync-account",
  redis: redisClient,
  retries: 2,
  hooks: {
    onRetry: ({ stepName, attempt, nextRetryDelayMs }) => {
      console.log(stepName, attempt, nextRetryDelayMs);
    },
    onComplete: ({ executionId, result }) => {
      console.log(executionId, result.synced);
    },
  },
  handler: async ({ input, step }) => {
    await step("sync", () => syncAccount(input.accountId));
    return { synced: true };
  },
});
```

### Limit concurrency by partition

`partitionBy` adds a per-key cap alongside the global cap. Both use the same `concurrency` value. `partitionKey` on `start` overrides `partitionBy`; resume keeps the stored key.

```typescript
const deploy = defineWorkflow<{ envId: string }, void>({
  name: "deploy",
  redis: redisClient,
  concurrency: 3,
  partitionBy: (input) => input.envId,
  handler: async ({ input, step }) => {
    await step("apply", () => applyDeployment(input.envId));
  },
});

await deploy.start({ envId: "production" });
await deploy.start({ envId: "staging" }, { partitionKey: "shared" });
```

One partition can still fill every global slot; `partitionBy` does not reserve slots for other keys.

### Keep terminal history

`retentionTTL` controls how long completed / failed / cancelled executions stay in Redis. `retentionMax` caps how many terminal executions remain per workflow name.

```typescript
const audit = defineWorkflow<{ userId: string }, { ok: true }>({
  name: "audit-user",
  redis: redisClient,
  retentionTTL: 60_000,
  retentionMax: 100,
  handler: async ({ input, step }) => {
    await step("record", () => recordAudit(input.userId));
    return { ok: true };
  },
});
```

Pass `Infinity` to keep forever, or `0` to unlink immediately after terminal. Failed executions can be resumed only while their keys still exist.

### Graceful shutdown

`stop()` ends polling, waits for in-flight work, and releases this process registration. Other replicas keep reclaiming and running the same workflow name.

```typescript
await onboard.stop();
```

## Reference

### Handler context

- `input`, `executionId`, `signal`
- `step(name, handler)` - durable side effect; handler gets `{ input, signal, fail }`
- `sleep(ms)` - durable timer (survives replay / reclaim)

`fail(message)` inside a step marks a non-retryable failure (`NonRetryableStepError`).

### Options

- **`name`** (required) - unique per process
- **`redis`** (required) - `Bun.RedisClient`
- **`handler`** (required)
- **`retries`** - step retries before workflow fails (default: 3; `0` = fail on first error)
- **`retryBackoff`** - `{ baseDelay, multiplier, maxDelay }` (defaults: 1000 / 2x / 30000)
- **`hooks`** - `onStart`, `onRetry`, `onError`, `onComplete`, `onCancel` (see [Hooks](#hooks))
- **`lockTTL`** - execution lease TTL in ms (default: 300000); also used as capacity slot TTL. While a process holds an execution, it refreshes that execution's capacity slots (global `*` and partition key if any) for the full lifetime (including `sleep` and retry backoff). After process death, the Redis slot remains owned until TTL; the next reclaim re-attaches via the same `executionId`. Differing replica `concurrency` values mean the effective cap is the max.
- **`timeout`** - per-step timeout in ms (default: same as `lockTTL`). Must be a non-negative finite number or `Infinity`. A hang is a retryable step failure, not a stuck `running` execution. The step `signal` is aborted; the execution is not cancelled, so retries can run. Handlers that ignore `signal` may keep running after timeout. Pass `Infinity` only if a step is allowed to run longer than the lease.
- **`retentionTTL`** - how long terminal executions (`completed` / `failed` / `cancelled`) stay in Redis, in ms (default: 86400000, 24h). `Infinity` keeps them forever. Any other value must be a non-negative number. `0` unlinks immediately after terminal. Pending and running keys are never expired. Failed executions can be `resume`d only while they still exist. A background sweep also expires leftover terminal keys with no TTL.
- **`retentionMax`** - optional cap on terminal executions per workflow name. Must be a positive integer. Oldest are `UNLINK`ed when the cap is exceeded. Works with or without a finite `retentionTTL`.
- **`concurrency`** - max parallel instances across replicas (default: 1). Also the number of workflow pollers in this process. Without `partitionBy`, all executions share one Redis slot pool of size `concurrency` (key `*`). With `partitionBy`, both the global pool and the per-key pool apply (each size `concurrency`). If replicas disagree on `concurrency`, the effective cap is the max.
- **`partitionBy`** - `(input) => string` for per-key concurrency across replicas. Empty keys throw. Cap applies for the whole execution, including durable waits. Does not replace the global `concurrency` cap - both apply. The key `*` is reserved for the global pool.
- **`pollInterval`** - idle poll backoff ms (default: 100)

`start(input, { executionId?, partitionKey? })` - `partitionKey` overrides `partitionBy`. Custom `executionId` must be non-empty and must not contain `:`. Empty `partitionKey` throws.

`partitionKey` on `start` overrides `partitionBy` when both are present. Empty keys throw. The resolved key is stored on execution meta so `resume` keeps the original partition.

Failed steps retry with exponential backoff before the workflow is marked `failed`. Default `retries: 3` means 4 total attempts. `retries: 0` fails on the first error.

`cancel` is honored during retry backoff and `sleep`, not only between steps. After terminal failure, `resume(executionId)` re-queues the execution.

### Hooks

Optional lifecycle callbacks. Errors in hooks never fail the workflow. Hooks fire on real transitions, not every history replay.

- `onStart` - once when the execution first moves `pending` → `running`
- `onRetry` - before each step retry backoff (`attempt`, `nextRetryDelayMs`, `retriesRemaining`, …)
- `onError` - retries exhausted, or immediately after `fail()`
- `onComplete` - terminal success
- `onCancel` - terminal cancel

### Redis keys

Prefix: `workflow:`

| Key | Purpose |
|-----|---------|
| `workflow:{name}:history:{executionId}` | append-only event list |
| `workflow:{name}:meta:{executionId}` | status cache for `get()` |
| `workflow:{name}:lease:{executionId}` | owner token + TTL |
| `workflow:{name}:queue` | workflow task queue |
| `workflow:{name}:timers` | sorted set of due timers / retry delays |
| `workflow:{name}:timer-dead` | unparseable timer payloads (dead letter) |
| `workflow:{name}:active` | non-terminal execution ids (reclaimer) |
| `workflow:{name}:terminal` | zset of terminal execution ids when `retentionMax` is set |
| `workflow:{name}:partition:{key}:{slot}` | concurrency slots (`SET NX PX`, re-ownable by same execution). Key `*` is the global pool; `partitionBy` keys are additional per-key pools |

Terminal `meta` and `history` keys receive `PEXPIRE` from `retentionTTL` (or are `UNLINK`ed when the TTL has already elapsed). Leases and partition slots keep using `lockTTL`. `listWorkflows` skips empty SCAN hits (expired tombstones).

### Notes

- Keep `step` / `sleep` call order and names stable across deploys; replay matches history by call sequence (`a0`, `a1`, …), and a renamed step at the same position is nondeterminism.
- Duplicate `defineWorkflow({ name })` in the same process throws `DuplicateWorkflowError`.
- Workers run embedded in your Bun process against Redis, not as a separate matching service.
- `get().steps` is `{ name, completedAt }[]` from completed history events (not a separate meta cache). Step return values are not exposed on `get()`.
- Successful step results are written to history even if cancel arrives mid-handler; the next advance then honors cancel.

### Statuses

`pending` | `running` | `completed` | `failed` | `cancelled`
