---
title: Workflow
description: Semola durable workflows - multi-step Redis jobs with resumable steps and retries
---

Durable workflows on Redis. Event history, deterministic replay, inline steps, multi-replica leases, and crashed or stalled runs that any replica picks up once `lockTTL` passes.
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

If a replica dies mid-run, its execution simply comes due again once `lockTTL` passes, and any replica (or the same process after restart) picks it up. If a run hits an internal error instead (for example a Redis failure), the replica hands the execution back to be retried after `retryBackoff.baseDelay` (at least `pollInterval`). There is no orphan scan, and you do not need to call `resume()` for crash recovery.

The heartbeat that keeps a lease alive runs on the same event loop as your steps. A step that blocks the event loop with synchronous work for longer than about 60% of `lockTTL` loses its lease, and another replica may start the same step while the first is still running. Keep steps async, or raise `lockTTL` for long synchronous work.

History and status writes are lease-fenced (Redis compare-and-append / compare-and-set against the lease token). Each state transition is a single Redis script, so history and status never disagree after a crash: a terminal event, its final status, leaving the due set, and retention are written together, as are `CompensationStarted` and status `compensating`. A writer that loses the lease cannot write; the new owner continues from history. While an execution is leased, the lease holder is the only writer of its history, so it loads history once per lease and keeps it in memory. Client paths do not take a lease: `start` creates meta, the first history event, and the due entry in one script; `resume` is one compare-and-set script on a failed execution; `cancel` sets a flag on meta (never history), which the lease holder sees on its next write. Losing a lease aborts the local forward `signal` so the handler can stop; another replica may still re-run the step once the execution comes due again (at-least-once).

`resume(executionId)` re-queues a **failed** execution in one atomic step: only while meta status is still `failed` and no unwind has started, it removes the retention TTL, appends a resume event (replay restarts failed steps at attempt 1), sets `pending`, and makes it due now. `pending` / `running` / `compensating` / `completed` / `cancelled` executions reject, as do failed executions that already started compensation. Concurrent `resume` calls on the same execution apply once; the others reject. A later failure needs a new resume event even if an older `WorkflowResumed` is already in history.

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

### Compensate steps

Pass `compensate` on a step to undo its side effects when the execution fails for good or is cancelled. The undo is registered as soon as the step **starts**, so it runs for every step that started: completed, failed (including exhausted retries or `fail()`), or still in flight or backing off when cancel arrived. Steps that never started are not undone. Undos run newest first (LIFO), so a failing step's own undo runs before earlier steps' undos.

`compensate` gets `completed`: with `completed: true`, `result` is the step's result; with `completed: false`, `result` is `undefined` and the step may have had partial effects or none at all (its handler may not even have run). Undos are at-least-once and must be idempotent.

```typescript
const onboard = defineWorkflow<{ userId: string }, { ok: true }>({
  name: "onboard-user",
  redis: redisClient,
  handler: async ({ input, step }) => {
    await step(
      "create-account",
      async () => createAccount(input.userId),
      {
        compensate: async ({ completed, result }) => {
          if (completed) {
            await deleteAccount(result.id);
            return;
          }

          // The step failed or was interrupted: undo whatever it managed.
          await deleteAccountIfExists(input.userId);
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

Status is `compensating` while unwind runs. Each undo is an ordinary durable step named `undo:<step name>`, with the same retry policy, backoff, `fail()` and `NonRetryableStepError` handling as forward steps. A successful unwind still ends as `failed` (original error) or `cancelled`. If an undo exhausts its retries, the execution is `failed` with that undo's error and the remaining undos do not run. If the replay diverges from history (nondeterminism, an unreadable step result, or the workflow function returning or throwing before every recorded step), the execution fails without running any undo. If `compensate` handlers disappear after `CompensationStarted` (for example a rolling deploy), including only some of them, the execution fails closed instead of finishing without undo. Unwind follows the `stepIds` snapshot on that event, so handlers added after start are not run.

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

Different keys do not share the cap. Same-key executions are limited to `concurrency` across all replicas. Each process also runs at most `concurrency` handlers at a time, whatever the number of keys, so cross-key parallelism comes from running more replicas (or raising `concurrency`).

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

`stop()` ends polling, waits for the runs in flight, and releases this process registration. Forward `signal` is aborted so handlers can exit; that abort does not write `WorkflowCancelled` or start compensation. Compensate `signal` is not aborted, so an undo step that is running finishes; the run then stops, and the rest of the unwind continues on whichever replica (or this process after a restart) picks the execution up next. Other replicas keep running the same workflow name; executions this process hands back are due again shortly.

```typescript
await onboard.stop();
```

## Reference

### Handler context

- `input`, `executionId`, `signal`
- `step(name, handler, options?)` - durable side effect; handler gets `{ input, signal, fail }`. `options.compensate` undoes a started step on failure or cancel; it gets `{ input, completed, result, signal, fail }` (`result` only when `completed`). Compensate `signal` is never aborted by cancel or `stop()`, so cleanup can finish.
- `sleep(ms)` - durable timer (survives replay and restarts). It counts as fired once a lease holder sees its fire time pass and records `TimerFired`; it stays fired after that, even if replica clocks disagree.

`fail(error)` inside a step marks a non-retryable failure and passes that `Error` to `onError`. Same inside `compensate`. History and status still store the message string. `throw new NonRetryableStepError(...)` remains non-retryable without going through `fail`.

### Options

- **`name`** (required) - unique per process
- **`redis`** (required) - `Bun.RedisClient`
- **`handler`** (required)
- **`retries`** - step retries before workflow fails (default: 3; `0` = fail on first error)
- **`retryBackoff`** - `{ baseDelay, multiplier, maxDelay }` (defaults: 1000 / 2x / 30000)
- **`hooks`** - `onStart`, `onRetry`, `onError`, `onComplete`, `onCancel` (see [Hooks](#hooks))
- **`lockTTL`** - execution lease TTL in ms (default: 300000); also how long a crashed replica's execution waits before another replica picks it up, and the grace period on capacity slots. The lease and the slot are renewed every 40% of `lockTTL` while a step runs. When a run stops to wait (`sleep`, retry backoff) the slot is kept until the wait ends plus `lockTTL`, with no process refreshing it; whoever runs the execution next renews it. If every replica is gone, the slot frees itself `lockTTL` after the execution was due. Terminal executions free their slot in the same write that records the final status.
- **`retentionTTL`** - how long terminal executions (`completed` / `failed` / `cancelled`) stay in Redis, in ms (default: 86400000, 24h). `Infinity` keeps them forever. Any other value must be a non-negative number. `0` unlinks immediately after terminal. Pending, running, and compensating keys are never expired. Failed executions can be `resume`d only while they still exist. Retention is applied when the execution becomes terminal, using the replica's settings at that moment; changing `retentionTTL` later does not touch executions that are already terminal.
- **`retentionMax`** - optional cap on terminal executions per workflow name. Must be a positive integer. Oldest are `UNLINK`ed when the cap is exceeded. Works with or without a finite `retentionTTL`.
- **`concurrency`** - max running or waiting executions per capacity key across replicas (default: 1), and the number of handlers one process runs at a time. Without `partitionBy`, all executions share one pool (key `*`). With `partitionBy`, each key has its own pool of size `concurrency` (no global cap). Each replica admits against its own `concurrency`, so if replicas disagree the effective cap is the max.
- **`partitionBy`** - `(input) => string` for per-key concurrency across replicas. Empty keys throw. Cap applies for the whole execution, including durable waits. Replaces the global `concurrency` cap. The key `*` is reserved for the unpartitioned pool.
- **`pollInterval`** - idle poll backoff ms (default: 100)

`start(input, { executionId?, partitionKey? })` - `partitionKey` overrides `partitionBy`. Custom `executionId` must be non-empty and must not contain `:`. Empty `partitionKey` throws.

`startSync(input, { executionId?, partitionKey?, timeoutMs?, cancelOnTimeout? })` - same start options, then wait for a terminal status (or `timeout`). Existing `executionId` attaches instead of throwing (prior input/partition win). `timeoutMs` must be a non-negative finite number. Failure returns an `Error` on `error`; does not throw.

Without `partitionBy`, `partitionKey` is stored on meta but capacity stays on the global `*` pool. Empty keys throw. The resolved key is stored on execution meta so `resume` keeps the original partition.

Failed steps retry with exponential backoff before the workflow is marked `failed`. Default `retries: 3` means 4 total attempts. `retries: 0` fails on the first error. The same retry policy applies to `compensate` handlers, and `onRetry` / `onError` fire for them too with step name `undo:<name>`.

`cancel` is honored during retry backoff and `sleep`, not only between steps. `cancel()` aborts the forward `signal` only on the replica that handles the call; a step running on another replica keeps going, its outcome is recorded, and the cancel is honored at that write. Started steps with `compensate` unwind before status becomes `cancelled`. After terminal failure, `resume(executionId)` re-queues the execution unless compensation already ran.

### Hooks

Optional lifecycle callbacks. Errors in hooks never fail the workflow. Hooks fire on real transitions, not every history replay.

- `onStart` - once when the execution first moves `pending` → `running`
- `onRetry` - before each step retry backoff (`attempt`, `nextRetryDelayMs`, `retriesRemaining`, …), including undo steps (`stepName` is `undo:<name>`).
- `onError` - a step's retries are exhausted or it called `fail()`, including undo steps (`undo:<name>`; may fire for both the forward step and an undo). `error` is the thrown/`fail()` `Error` instance (use `instanceof` for typed branches). `errorHistory` lists that step's failed attempts since the last resume (messages as strings).
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
| `workflow:{name}:capacity:{key}` | sorted set of execution ids holding a capacity slot, scored by slot expiry (ms epoch). Key `*` is the unpartitioned pool; `partitionBy` keys are per-key pools |

Terminal `meta` and `history` keys receive `PEXPIRE` from `retentionTTL` in the same script that records the terminal status (or are `UNLINK`ed there when `retentionTTL` is `0`). `retentionMax` trimming runs right after that terminal write. Leases and capacity slots keep using `lockTTL`. `listWorkflows` skips empty SCAN hits (expired tombstones).

### Notes

- Keep `step` / `sleep` call order and names stable across deploys; replay matches history by call sequence (`a0`, `a1`, …), and a renamed step at the same position is nondeterminism.
- Duplicate `defineWorkflow({ name })` in the same process throws `DuplicateWorkflowError`.
- Workers run embedded in your Bun process against Redis, not as a separate matching service.
- `get().steps` is `{ name, completedAt }[]` from completed history events (not a separate meta cache). Step return values are not exposed on `get()`.
- Successful step results are written to history even if cancel arrives mid-handler; the next advance then honors cancel.
- `compensate` runs for every started step (completed or not), newest first. Undos are at-least-once and must be idempotent and tolerate partial or no effects. `resume()` after compensation throws.

### Statuses

`pending` | `running` | `compensating` | `completed` | `failed` | `cancelled`
