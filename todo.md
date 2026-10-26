# Workflow refactor leftovers

Leftovers from the workflow refactor on `noah/timer-refactor`. This branch can't pick up executions written by v0.6.9: there's no `due` set, the keys are different, and the old `Compensation*` / `WorkflowCancelRequested` events are gone. So code that tolerates old history formats isn't protecting anything.

Suggested order: 3 and 4 first (they fix a bug and remove per-step Redis calls), then 1 and 2 together (they change the history format and the tests that depend on it).

## Leftover concepts

- [ ] **1. Merge `StepScheduled` and `StepStarted` into one event.**
  In the old queue model a step was scheduled first and picked up by a worker later. Now `runStep` commits `StepScheduled`, and `executeStep` ([engine.ts:742](src/lib/workflow/engine.ts#L742)) commits `StepStarted` right after it on the same lease.
  - Every step attempt makes two Redis round-trips instead of one.
  - The step state has a `"scheduled"` status that `nextStep` ([engine.ts:137](src/lib/workflow/engine.ts#L137)) treats exactly like `"started"`.
  - `StepStarted` doesn't carry `stepName`, so [history.ts:68](src/lib/workflow/history.ts#L68) falls back to `previous?.stepName ?? ""`.
  - The only remaining non-trivial use of `StepScheduled` is `resume()` resetting attempt counts (see 2).

- [ ] **2. Make `WorkflowResumed` reset failed steps, so `resume()` doesn't build step events.**
  `resume()` ([index.ts:257-267](src/lib/workflow/index.ts#L257-L267)) loads history, writes a `StepScheduled` with `attempt: 1` for each failed step, then guards that with `historyLength`, the CAS in `RESUME_EXECUTION` and a 3-try loop (`RESUME_ATTEMPTS`). If `applyHistoryEvent` handled `WorkflowResumed` by resetting failed forward steps, `resume` would only append that one event. Most of the "history changed since read" machinery would go away; the read is still needed for the "already compensated" check.

- [ ] **3. Make the abort controller and lost-lease state per run, not per execution. This is a bug.**
  - The heartbeat aborts `aborts.get(executionId)` when a lease is lost ([engine.ts:1073](src/lib/workflow/engine.ts#L1073)).
  - That controller is only removed on a terminal commit (`clearExecutionLocalState`, [engine.ts:1079](src/lib/workflow/engine.ts#L1079)).
  - If the same process claims that execution again later, the handler gets a signal that is already aborted. A failed attempt then hits `if (controller.signal.aborted) return false` and is never recorded, so it re-runs every poll interval.
  - `requestAbort` from `cancel()` creates a controller for an execution this process isn't running, and it leaks.

  Fix: create the controller in `runClaimed`, register it in a map only for the life of the run, and have `requestAbort` abort it only if it's there. `lostLeases` becomes a `run.lost` flag. `clearExecutionLocalState` is no longer needed.

- [ ] **4. Drop the Redis `GET` in `ownsLease`.**
  `ownsLease` ([engine.ts:515](src/lib/workflow/engine.ts#L515)) does a Redis `GET` on every loop iteration and after every step. Every write is already fenced by the lease in `COMMIT`, so a lost lease shows up as `commitRun` returning `false` anyway. Checking a local `run.lost` flag (see 3) is enough. `store.getLease` then has no production caller; it's only used in tests.

- [ ] **5. Remove code that handles old `CompensationStarted` events without `stepIds`.**
  - `stepIds?` is optional in [types.ts:288](src/lib/workflow/types.ts#L288).
  - `Array.isArray(...)` normalises it in [history.ts:140](src/lib/workflow/history.ts#L140).
  - `phase.stepIds.length === 0` is treated as "handlers missing" in [engine.ts:935](src/lib/workflow/engine.ts#L935). `startUnwind` never commits an empty list, so this can't happen.
  - Test "CompensationStarted without stepIds normalizes to empty list" in [history.test.ts:219](src/lib/workflow/history.test.ts#L219).

- [ ] **6. Remove `input` / `partitionKey` from `WorkflowStarted` test fixtures.**
  They're in [history.test.ts](src/lib/workflow/history.test.ts) (lines 26, 66, 178, 225) and [index.test.ts:2266](src/lib/workflow/index.test.ts#L2266). Input and partition key live on meta now.

## Code that can't run or isn't needed

- [ ] **7. Keep one terminal guard instead of several.**
  A terminal commit removes the execution from `due` in the same script, and nothing re-adds a terminal one, so `claimDue` can't return it. Two guards are unreachable:
  - `isTerminalStatus(meta.status)` in `runExecution` ([engine.ts:588](src/lib/workflow/engine.ts#L588)).
  - `if (view.terminal) return` at the top of the run loop ([engine.ts:637](src/lib/workflow/engine.ts#L637)). The loop returns right after any terminal commit, so this only matters on the first pass, which the meta check already covers.

  `HistoryTerminal.result` and `.error` are then barely read. The only other reader is the `startSync` failure path ([index.ts:403](src/lib/workflow/index.ts#L403)), and its `view.terminal.error` branch always equals `meta.error`.

- [ ] **8. Make `dueAt` required on `releaseLease`.**
  The engine always passes `dueAt`; only a store test helper ([store.test.ts:49](src/lib/workflow/store.test.ts#L49)) omits it. Remove the `""` handling in `RELEASE_LEASE`. `LeaseInput` is also shared by extend and release even though `dueAt` only applies to release; split it.

- [ ] **9. Await the loop promises in `stop()` instead of polling `active`.**
  `stop()` polls `active` every `SHUTDOWN_POLL` ms. `start()` could keep the `workflowLoop()` promises and `stop()` could `await Promise.all(...)` them. That removes the `active` counter and the polling.

- [ ] **10. Poll meta, not `get()`, in `startSync`.**
  `startSync` calls `get()` on every poll. Each call parses the input and the full history and builds `steps`, all thrown away until the run is terminal. Polling `getMeta` and reading history once at the end, for the failure message, is enough.

## Smaller items

- [ ] `RedisZMember` in [types.ts](src/lib/workflow/types.ts) is unused.
- [ ] `finishCompensation`'s `error ?? "workflow failed"` fallback ([engine.ts:1002](src/lib/workflow/engine.ts#L1002)): when the reason is `"failed"`, `error` is never null.
- [ ] `parseHistory` ([history.ts:154](src/lib/workflow/history.ts#L154)) reimplements `fromJson` from [json.ts](src/lib/workflow/json.ts).
- [ ] `isTerminalStatus` sits in [history.ts](src/lib/workflow/history.ts) but is about meta status.
- [ ] Single-use input types are applied unevenly. `FailExecutionInput` and `CommitTerminalInput` take `LeaseRun` without `TInput`, while their siblings take `LeaseRun<TInput>`.
- [ ] `WorkflowStartResult.status` is always `"pending"`; it could be a literal type.
- [ ] The `pending` → `running` commit ([engine.ts:614](src/lib/workflow/engine.ts#L614)) is a separate round-trip and could go in the first decision's commit.
- [ ] Docs: the intro of [docs/workflow.md](docs/workflow.md#L6) still says "automatic orphan recovery" while line 72 says "There is no orphan scan".
