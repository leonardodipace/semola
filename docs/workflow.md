# Workflow

Durable workflows on Redis. Event history, deterministic replay, steps, multi-replica leases, and automatic orphan recovery.

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

`defineWorkflow` starts embedded workers in the current process. Call `stop()` on shutdown.

## Durability model

Each execution has an append-only event history in Redis. Workers advance the workflow by:

1. Loading history
2. Replaying the workflow function from the start
3. Resolving completed `step` / `sleep` calls from history (no side effects)
4. Scheduling the next step or timer, or completing / failing / cancelling

Side effects belong inside `step`. Workflow code outside `step` / `sleep` must be deterministic relative to history: no raw `Date.now()`, `Math.random()`, network, or unseeded nondeterminism.

Steps are **at-least-once**. `step` bodies must be idempotent; a crash mid-step may re-run the handler.

## Multi-replica and automatic recovery

N Bun processes may register the same workflow `name` against the same Redis. Work is distributed via task queues and per-execution leases (`lockTTL`).

If a replica dies mid-run, lease expiry lets another replica (or the same process after restart) reclaim the execution. **No** boot-time `list` + `resume` loop is required.

`resume(executionId)` is only for **failed** executions you want to retry after terminal failure. Crash recovery is automatic.

## API

### Instance

- `start(input, options?)` - persist started event, enqueue workflow task, return `{ executionId, status: "pending" }`
- `get(executionId)` - status, result, error, step snapshots
- `cancel(executionId)` - durable cancel request + `AbortSignal`; returns current status with `cancelledAt: number | null` (null until terminal `cancelled`; poll `get`)
- `resume(executionId)` - re-queue a **failed** execution
- `stop()` - stop polling, wait for in-flight work, release process registration

### Top-level

- `defineWorkflow(options)` - register and start workers

### Handler context

- `input`, `executionId`, `signal`
- `step(name, handler)` - durable side effect
- `sleep(ms)` - durable timer

Inside a step: `fail(message)` marks a non-retryable failure.

## Options

- **`name`** (required) - unique per process
- **`redis`** (required) - `Bun.RedisClient`
- **`handler`** (required)
- **`retries`** - step retries before workflow fails (default: 3; `0` = fail on first error)
- **`retryBackoff`** - `{ baseDelay, multiplier, maxDelay }` (defaults: 1000 / 2x / 30000)
- **`hooks`** - `onStart`, `onRetry`, `onError`, `onComplete`, `onCancel` (errors in hooks never fail the workflow; hooks fire on real transitions, not every replay)
- **`lockTTL`** - execution lease TTL in ms (default: 300000)
- **`concurrency`** - workflow + step pollers in this process (default: 1 each). With partitions, also Redis per-key cap when replicas share the value
- **`partitionBy`** - `(input) => string` for per-key concurrency
- **`pollInterval`** - idle poll backoff ms (default: 100)
- **`serialize*` / `deserialize*`** - custom codecs for input, result, and step output (default: plain `JSON.stringify` / `JSON.parse`)

`start(input, { executionId?, partitionKey? })` - `partitionKey` overrides `partitionBy`.

## Redis keys

Prefix: `workflow:`

| Key | Purpose |
|-----|---------|
| `workflow:{name}:history:{executionId}` | append-only event list |
| `workflow:{name}:meta:{executionId}` | status cache for `get()` |
| `workflow:{name}:lease:{executionId}` | owner token + TTL |
| `workflow:{name}:wf-queue` | workflow task queue |
| `workflow:{name}:step-queue` | step task queue |
| `workflow:{name}:timers` | sorted set of due timers / retry delays |
| `workflow:{name}:active` | non-terminal execution ids (reclaimer) |
| `workflow:{name}:partition:{key}:{slot}` | per-key concurrency slots (`SET NX PX`) |

## Statuses

`pending` | `running` | `completed` | `failed` | `cancelled`


Workers run embedded in your Bun process against Redis, not as a separate matching service.
