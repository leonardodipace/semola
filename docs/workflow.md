# Workflow

Durable workflows on Redis. Event history, deterministic replay, inline steps, multi-replica leases, and automatic orphan recovery.

## Import

```typescript
import {
  defineWorkflow,
  NotFoundError,
  type WorkflowExecution,
} from "semola/workflow";
```

Also exported: `DuplicateWorkflowError`, `NonRetryableStepError`, `SerializationError`, `WorkflowStoreError`, and the public workflow types (`Workflow`, `WorkflowOptions`, hooks/status/start/cancel shapes, etc.).

## Basic Usage

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

If a replica dies mid-run, lease expiry lets another replica (or the same process after restart) reclaim the execution. **No** boot-time recovery loop is required.

History and status writes are lease-fenced (Redis compare-and-append / compare-and-set against the lease token). A writer that loses the lease cannot append; the new owner continues from history. Client paths (`start` / cancel / resume) append without a lease.

`resume(executionId)` is only for **failed** executions: it appends a resume event, re-schedules failed steps from history, and re-queues the workflow. Crash recovery is automatic via leases.

## API

### Instance

- `name` - workflow name used for registration and Redis keys
- `start(input, options?)` - persist `WorkflowStarted`, enqueue workflow task, return `{ executionId, status: "pending" }`
- `get(executionId)` - status, result, error, step snapshots
- `cancel(executionId)` - append `WorkflowCancelRequested` and abort in-process work; returns current status with `cancelledAt: number | null` (null until terminal `cancelled`; poll `get`)
- `resume(executionId)` - re-queue a **failed** execution (throws if not `failed`)
- `stop()` - stop polling, wait for in-flight work, release process registration

### Top-level

- `defineWorkflow(options)` - register and start workers

### Handler context

- `input`, `executionId`, `signal`
- `step(name, handler)` - durable side effect; handler gets `{ input, signal, fail }`
- `sleep(ms)` - durable timer (survives replay / reclaim)

`fail(message)` inside a step marks a non-retryable failure (`NonRetryableStepError`).

## Options

- **`name`** (required) - unique per process
- **`redis`** (required) - `Bun.RedisClient`
- **`handler`** (required)
- **`retries`** - step retries before workflow fails (default: 3; `0` = fail on first error)
- **`retryBackoff`** - `{ baseDelay, multiplier, maxDelay }` (defaults: 1000 / 2x / 30000)
- **`hooks`** - `onStart`, `onRetry`, `onError`, `onComplete`, `onCancel` (see [Hooks](#hooks))
- **`lockTTL`** - execution lease TTL in ms (default: 300000); also used as partition slot TTL. While a process holds an execution, it refreshes that execution's partition slot for the full lifetime (including `sleep` and retry backoff). After process death, the Redis slot remains owned until TTL; the next reclaim re-attaches via the same `executionId`. Differing replica `concurrency` values mean the effective cap is the max.
- **`concurrency`** - workflow pollers in this process (default: 1). With partitions, also the Redis per-key cap when every replica uses the same value; if replicas differ, the effective cap is the max
- **`partitionBy`** - `(input) => string` for per-key concurrency across replicas. Empty keys throw. Cap applies for the whole execution, including durable waits
- **`pollInterval`** - idle poll backoff ms (default: 100)

`start(input, { executionId?, partitionKey? })` - `partitionKey` overrides `partitionBy`. Custom `executionId` must be non-empty and must not contain `:`. Empty `partitionKey` throws.

```typescript
defineWorkflow({
  name: "deploy",
  redis: redisClient,
  concurrency: 3,
  partitionBy: (input) => input.envId,
  handler: async ({ step }) => {
    await step("apply", async () => {});
  },
});
```

## Retries

Failed steps retry with exponential backoff before the workflow is marked `failed`. Default `retries: 3` means 4 total attempts. `retries: 0` fails on the first error.

```typescript
await step("charge", async ({ fail }) => {
  if (!cardId) fail("missing card");
});
```

`cancel` is honored during retry backoff and `sleep`, not only between steps. After terminal failure, `resume(executionId)` re-queues the execution.

## Hooks

Optional lifecycle callbacks. Errors in hooks never fail the workflow. Hooks fire on real transitions, not every history replay.

- `onStart` - once when the execution first moves `pending` → `running`
- `onRetry` - before each step retry backoff (`attempt`, `nextRetryDelayMs`, `retriesRemaining`, …)
- `onError` - retries exhausted, or immediately after `fail()`
- `onComplete` - terminal success
- `onCancel` - terminal cancel

## Redis keys

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
| `workflow:{name}:partition:{key}:{slot}` | per-key concurrency slots (`SET NX PX`, re-ownable by same execution) |

## Notes

- Keep `step` / `sleep` call order and names stable across deploys; replay matches history by call sequence (`a0`, `a1`, …), and a renamed step at the same position is nondeterminism.
- Duplicate `defineWorkflow({ name })` in the same process throws `DuplicateWorkflowError`.
- Workers run embedded in your Bun process against Redis, not as a separate matching service.
- `get().steps` is built from completed steps in history (not a separate meta cache).
- Successful step results are written to history even if cancel arrives mid-handler; the next advance then honors cancel.

## Breaking changes (v2)

- Redis keys: `wf-queue` / `step-queue` replaced by a single `queue`. No migration - drain or abandon in-flight work before cutover.
- Custom `serialize*` / `deserialize*` options removed. Payloads use `JSON.stringify` / `JSON.parse` only.
- `concurrency` is the number of workflow pollers in this process. Steps run **inline** under the lease, so a long step occupies one poller for its full duration (no separate step-worker pool).
- Step snapshots on `get()` come from event history, not `meta.steps`.

## Statuses

`pending` | `running` | `completed` | `failed` | `cancelled`
