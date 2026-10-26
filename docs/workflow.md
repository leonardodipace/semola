---
title: Workflow
description: Semola durable workflows - multi-step Redis jobs with resumable steps and retries
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

`startSync()` starts (or attaches to) an execution and waits until it is terminal (`completed` / `failed` / `cancelled`). It does not throw on child failure: read `status` and `error`. Use it inside a parent `step` so replay reuses the memoized child result instead of waiting again.

## Durability model

Each execution has an append-only event history in Redis. A single lease owner advances the workflow by:

1. Loading history
2. Replaying the workflow function from the start
3. Resolving completed `step` / `sleep` calls from history (no side effects)
4. Running the next incomplete step **inline** under the same lease, or scheduling a durable timer, or completing / failing / cancelling

Side effects belong inside `step`. Workflow code outside `step` / `sleep` must be deterministic relative to history: no raw `Date.now()`, `Math.random()`, network, or unseeded nondeterminism.

Steps are **at-least-once**. `step` bodies must be idempotent; a crash mid-step may re-run the handler. Input, result, and step outputs are always JSON (`JSON.stringify` / `JSON.parse`).

## Multi-replica and automatic recovery

N Bun processes may register the same workflow `name` against the same Redis. Work is distributed via one sorted set of executions scored by when each next needs advancing, plus per-execution leases (`lockTTL`). A worker claims a due execution by taking its lease and pushing its score `lockTTL` ahead; the heartbeat keeps pushing it while the run is alive. When the run stops it leaves the score at the next thing it waits for: a `sleep`'s fire time or a retry's backoff. Sleeping executions cost nothing until they are due.

If a replica dies mid-run, its execution simply comes due again once `lockTTL` passes, and any replica (or the same process after restart) picks it up. There is no orphan scan, and you do not need to call `resume()` for crash recovery.

History and status writes are lease-fenced (Redis compare-and-append / compare-and-set against the lease token). Each state transition is a single Redis script, so history and status never disagree after a crash: a terminal event, its final status, leaving the due set, and retention are written together, as are `CompensationStarted` and status `compensating`. A writer that loses the lease cannot write; the new owner continues from history. While an execution is leased, the lease holder is the only writer of its history, so it loads history once per lease and keeps it in memory. Client paths do not take a lease: `start` creates meta, the first history event, and the due entry in one script; `resume` is one compare-and-set script on a failed execution; `cancel` sets a flag on meta (never history), which the lease holder sees on its next write. Losing a lease aborts the local forward `signal` so the handler can stop; another replica may still re-run the step once the execution comes due again (at-least-once).

`resume(executionId)` re-queues a **failed** execution in one atomic step: only while meta status is still `failed` and history is unchanged since resume read it, it removes the retention TTL, appends a resume event, re-schedules failed steps, sets `pending`, and makes it due now. `pending` / `running` / `compensating` / `completed` / `cancelled` executions reject, as do failed executions that already started compensation. Concurrent `resume` calls on the same execution apply once; the others reject. A later failure needs a new resume event even if an older `WorkflowResumed` is already in history.

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

while (
  execution.status === "pending" ||
  execution.status === "running" ||
  execution.status === "compensating"
) {
  await Bun.sleep(100);
  execution = await onboard.get(executionId);
}

console.log(execution.status, execution.result, execution.error);
console.log(execution.steps);
// steps: { name, completedAt }[] - return values stay in history, not on get()
```

### Wait for a child workflow

`startSync(input, { executionId?, partitionKey?, timeoutMs?, cancelOnTimeout? })` starts the run and waits through `pending` / `running` / `compensating` until a final status. If `executionId` already exists, it attaches and waits instead of throwing `WorkflowStoreError`. Attach keeps the prior run's input and partition key; the new call's values are ignored.

On failure, `error` is an `Error` whose message is the original forward failure (not a later compensate error). If a compensate handler also fails, `get().error` holds the compensate error instead. Cancel-triggered compensation that then fails surfaces the compensate error (there was no forward failure).

```typescript
const parent = defineWorkflow<{ userId: string }, { ok: true }>({
  name: "parent",
  redis: redisClient,
  handler: async ({ input, step }) => {
    await step("onboard", async () => {
      const child = await onboard.startSync(
        { userId: input.userId },
        {
          executionId: `onboard-${input.userId}`,
          timeoutMs: 30_000,
          cancelOnTimeout: true,
        },
      );

      if (child.status !== "completed") {
        throw new Error(`onboard ${child.status}`);
      }

      return child.result;
    });

    return { ok: true };
  },
});
```

`timeoutMs` must be a non-negative finite number. It returns `{ status: "timeout", result: null, error: null }`. With `cancelOnTimeout`, it calls `cancel()` first. Poll interval matches the workflow `pollInterval`.

### Cancel an execution

`cancel()` records the request and aborts local work. The return value may still be `pending`, `running`, or `compensating`. Cancelling a `completed` / `failed` / `cancelled` or `compensating` execution changes nothing and returns its current status. Poll until status is `cancelled`, or `failed` if compensation itself exhausts retries.

```typescript
const requested = await onboard.cancel(executionId);
console.log(requested.status);

let execution = await onboard.get(executionId);

while (
  execution.status !== "cancelled" &&
  execution.status !== "failed"
) {
  await Bun.sleep(100);
  execution = await onboard.get(executionId);
}

console.log(execution.cancelledAt);
```

### Resume a failed execution

`resume()` re-queues a failed execution and returns `pending`. Completed steps stay cached and are not repeated. Non-failed statuses reject. If another caller resumes the run (and a worker finishes it) before this resume applies, resume rejects and leaves that status alone.

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
  status: ["pending", "running", "compensating"],
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

### Compensate completed steps

Pass `compensate` on a step to undo its side effects if a later step fails for good, or if the execution is cancelled. Compensations run in reverse order of completion (LIFO), use the same retry policy as forward steps, and must be idempotent. Only **completed** steps are compensated.

```typescript
const onboard = defineWorkflow<{ userId: string }, { ok: true }>({
  name: "onboard-user",
  redis: redisClient,
  handler: async ({ input, step }) => {
    await step(
      "create-account",
      async () => createAccount(input.userId),
      {
        compensate: async ({ result }) => {
          await deleteAccount(result.id);
        },
      },
    );

    await step("send-email", async () => {
      await emailClient.send(input.userId);
    });

    return { ok: true };
  },
});
```

Status is `compensating` while unwind runs. A successful unwind still ends as `failed` (original error) or `cancelled`. If a compensation itself exhausts retries, the execution is `failed` with that compensation error. If compensation collect hits nondeterminism, cannot load step results, or the handler throws before every completed step is replayed, unwind does not start with a partial list. If `compensate` handlers disappear after `CompensationStarted` (for example a rolling deploy), including only some of them, the execution fails closed instead of finishing without undo. Unwind follows the `stepIds` snapshot on that event, so handlers added after start are not run.

`resume()` is rejected after compensation has started. Completed step results would be wrong after undo; start a new execution. Failed executions that never compensated can still be resumed.

### Fail without retrying

Call `fail(error)` inside a step for a non-retryable failure. Pass an `Error` (or subclass) so `onError` can branch with `instanceof`.

```typescript
class CardDeclinedError extends Error {}

const payment = defineWorkflow<{ orderId: string }, { charged: true }>({
  name: "charge-order",
  redis: redisClient,
  hooks: {
    onError: ({ error }) => {
      if (error instanceof CardDeclinedError) {
        // ...
      }
    },
  },
  handler: async ({ input, step }) => {
    await step("charge", async ({ fail }) => {
      const charged = await charge(input.orderId);

      if (!charged) {
        fail(new CardDeclinedError("card declined"));
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

Without `partitionBy`, `concurrency` is global. With `partitionBy`, it is per key. `partitionKey` on `start` overrides `partitionBy`; resume keeps the stored key.

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

Different keys do not share the cap. Same-key executions are limited to `concurrency`.

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

`stop()` ends polling, waits for in-flight work (including compensate unwind), and releases this process registration. Forward `signal` is aborted so handlers can exit; that abort does not write `WorkflowCancelled` or start compensation. Compensate `signal` is not aborted, so cleanup can finish. Other replicas keep running the same workflow name; executions this process hands back are due again immediately.

```typescript
await onboard.stop();
```

## Reference

### Handler context

- `input`, `executionId`, `signal`
- `step(name, handler, options?)` - durable side effect; handler gets `{ input, signal, fail }`. `options.compensate` undoes a completed step on later failure or cancel; it gets `{ input, result, signal, fail }`. Compensate `signal` is not the cancelled forward signal, so cleanup can finish after cancel.
- `sleep(ms)` - durable timer (survives replay and restarts). It counts as fired once a lease holder sees its fire time pass and records `TimerFired`; it stays fired after that, even if replica clocks disagree.

`fail(error)` inside a step marks a non-retryable failure and passes that `Error` to `onError`. Same inside `compensate`. History and status still store the message string. `throw new NonRetryableStepError(...)` remains non-retryable without going through `fail`.

### Options

- **`name`** (required) - unique per process
- **`redis`** (required) - `Bun.RedisClient`
- **`handler`** (required)
- **`retries`** - step retries before workflow fails (default: 3; `0` = fail on first error)
- **`retryBackoff`** - `{ baseDelay, multiplier, maxDelay }` (defaults: 1000 / 2x / 30000)
- **`hooks`** - `onStart`, `onRetry`, `onError`, `onComplete`, `onCancel` (see [Hooks](#hooks))
- **`lockTTL`** - execution lease TTL in ms (default: 300000); also used as capacity slot TTL. While a process holds an execution, it refreshes that execution's capacity slot for the full lifetime (including `sleep` and retry backoff). After process death, the Redis slot remains owned until TTL; the next run of the same `executionId` re-attaches it. Differing replica `concurrency` values mean the effective cap is the max.
- **`retentionTTL`** - how long terminal executions (`completed` / `failed` / `cancelled`) stay in Redis, in ms (default: 86400000, 24h). `Infinity` keeps them forever. Any other value must be a non-negative number. `0` unlinks immediately after terminal. Pending, running, and compensating keys are never expired. Failed executions can be `resume`d only while they still exist. Retention is applied when the execution becomes terminal, using the replica's settings at that moment; changing `retentionTTL` later does not touch executions that are already terminal.
- **`retentionMax`** - optional cap on terminal executions per workflow name. Must be a positive integer. Oldest are `UNLINK`ed when the cap is exceeded. Works with or without a finite `retentionTTL`.
- **`concurrency`** - max parallel instances across replicas (default: 1). Without `partitionBy`, all executions share one Redis slot pool of size `concurrency` (key `*`) and this process runs that many pollers. With `partitionBy`, each key has its own pool of size `concurrency` (no global cap). If replicas disagree on `concurrency`, the effective cap is the max.
- **`partitionBy`** - `(input) => string` for per-key concurrency across replicas. Empty keys throw. Cap applies for the whole execution, including durable waits. Replaces the global `concurrency` cap. The key `*` is reserved for the unpartitioned pool.
- **`pollInterval`** - idle poll backoff ms (default: 100)

`start(input, { executionId?, partitionKey? })` - `partitionKey` overrides `partitionBy`. Custom `executionId` must be non-empty and must not contain `:`. Empty `partitionKey` throws.

`startSync(input, { executionId?, partitionKey?, timeoutMs?, cancelOnTimeout? })` - same start options, then wait for a terminal status (or `timeout`). Existing `executionId` attaches instead of throwing (prior input/partition win). `timeoutMs` must be a non-negative finite number. Failure returns an `Error` on `error`; does not throw.

Without `partitionBy`, `partitionKey` is stored on meta but capacity stays on the global `*` pool. Empty keys throw. The resolved key is stored on execution meta so `resume` keeps the original partition.

Failed steps retry with exponential backoff before the workflow is marked `failed`. Default `retries: 3` means 4 total attempts. `retries: 0` fails on the first error. The same retry policy applies to `compensate` handlers. `onRetry` fires only for forward step retries, not compensate retries.

`cancel` is honored during retry backoff and `sleep`, not only between steps. `cancel()` aborts the forward `signal` only on the replica that handles the call; a step running on another replica keeps going, its outcome is recorded, and the cancel is honored at that write. Completed steps with `compensate` unwind before status becomes `cancelled`. After terminal failure, `resume(executionId)` re-queues the execution unless compensation already ran.

### Hooks

Optional lifecycle callbacks. Errors in hooks never fail the workflow. Hooks fire on real transitions, not every history replay.

- `onStart` - once when the execution first moves `pending` → `running`
- `onRetry` - before each forward step retry backoff (`attempt`, `nextRetryDelayMs`, `retriesRemaining`, …). Not fired for `compensate` retries.
- `onError` - forward-step retries exhausted, immediately after `fail()`, or when a `compensate` handler exhausts retries (may fire twice if both happen). `error` is the thrown/`fail()` `Error` instance (use `instanceof` for typed branches). Compensate calls pass `errorHistory` from `CompensationFailed` attempts only (messages as strings).
- `onComplete` - terminal success
- `onCancel` - terminal cancel

### Redis keys

Prefix: `workflow:`

| Key | Purpose |
|-----|---------|
| `workflow:{name}:history:{executionId}` | append-only event list, written by `start`, `resume`, and the lease holder |
| `workflow:{name}:meta:{executionId}` | status, result/error, timestamps, and `cancelRequestedAt` (set by `cancel`, cleared by `resume`) |
| `workflow:{name}:lease:{executionId}` | owner token + TTL |
| `workflow:{name}:due` | sorted set of non-terminal execution ids, scored by when each next needs advancing (ms epoch) |
| `workflow:{name}:terminal` | zset of terminal execution ids when `retentionMax` is set |
| `workflow:{name}:partition:{key}:{slot}` | concurrency slots (`SET NX PX`, re-ownable by same execution). Key `*` is the unpartitioned pool; `partitionBy` keys are per-key pools |

Terminal `meta` and `history` keys receive `PEXPIRE` from `retentionTTL` in the same script that records the terminal status (or are `UNLINK`ed there when `retentionTTL` is `0`). `retentionMax` trimming runs right after that terminal write. Leases and partition slots keep using `lockTTL`. `listWorkflows` skips empty SCAN hits (expired tombstones).

### Notes

- Keep `step` / `sleep` call order and names stable across deploys; replay matches history by call sequence (`a0`, `a1`, …), and a renamed step at the same position is nondeterminism.
- Duplicate `defineWorkflow({ name })` in the same process throws `DuplicateWorkflowError`.
- Workers run embedded in your Bun process against Redis, not as a separate matching service.
- `get().steps` is `{ name, completedAt }[]` from completed history events (not a separate meta cache). Step return values are not exposed on `get()`.
- Successful step results are written to history even if cancel arrives mid-handler; the next advance then honors cancel.
- `compensate` runs only for completed steps, in reverse completion order. Compensations are at-least-once and must be idempotent. `resume()` after compensation throws.

### Statuses

`pending` | `running` | `compensating` | `completed` | `failed` | `cancelled`
