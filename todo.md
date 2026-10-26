# Workflow refactor: follow-up plan

Follow-ups from the review of `noah/timer-refactor`, after checking each claim against the code.

**Premise:** this branch can't pick up executions written by v0.6.9. They have no `due` entry, the keys are different, and the `Compensation*` / `WorkflowCancelRequested` events are gone. Code that tolerates old history formats protects nothing. The release must be marked as a breaking storage change: drain executions before upgrading.

**Rules for every step:**
- One step = one commit.
- Net production lines should go down, except step 1, which is a bug fix.
- Run `SEMOLA_REDIS_URL=redis://127.0.0.1:6391 bun test src/lib/workflow`, `bunx tsc --noEmit` and `bunx biome check .`.
- The test helpers `FLUSHDB` the target database. Only ever point them at the throwaway `semola-test-redis` on port 6391, never at 6379.

## Steps

- [x] **1. Fix the stale abort controller after a lost lease (bug).**
  - **Problem:** `aborts` is keyed by execution and only cleared on a terminal commit. When the heartbeat loses a lease it aborts that controller, and the next run of the same execution in this process reuses it. Any failure is then dropped (`if (controller.signal.aborted) return false`), so the step re-runs every poll interval and ignores `retries`. Reproduced: one lost lease, 199 attempts in 2.5 s, 0 `StepFailed`, stuck `running`. Separately, `cancel()` → `requestAbort` creates a controller for executions this process isn't running, which leaks.
  - **Fix:**
    - `runClaimed` creates the controller and stores it on the run (`run.controller`). It's registered in a map only for the life of that run.
    - `requestAbort` and `stop()` abort only registered, live runs.
    - A `run.lost` flag replaces `lostLeases`.
    - Delete `clearExecutionLocalState` and `abortController`.
  - **Tests:** a regression test (lose the lease mid-step, the same process reclaims it, the failure is recorded and `retries` is respected) and a test that `cancel()` from a non-running process doesn't leak.

- [x] **2. Drop the Redis `GET` in `ownsLease`.**
  - Every write is fenced by the lease in `COMMIT`, and a handler only runs right after a successful fenced `StepStarted` commit, so a lost lease already shows up as `commitRun` returning `false`.
  - Replace `ownsLease` with the local `run.lost` flag from step 1.
  - Delete `store.getLease`; tests read the lease key directly.

- [x] **3. One event per step attempt, and atomic resume.**
  - **Merge `StepScheduled` into `StepStarted`:**
    - `StepStarted` carries `stepName` and `attempt`, and is the only event written when an attempt begins (one round trip instead of two).
    - Remove the `"scheduled"` step status and the `previous?.stepName ?? ""` fallback.
    - The `runStep` decision carries the `StepStarted` event, which `executeStep` commits.
  - **`WorkflowResumed` resets failed forward steps in `applyHistoryEvent`,** so the next attempt starts at 1. `resume()` then appends only `WorkflowResumed`.
  - **Make resume atomic without the read-then-CAS:**
    - `startUnwind` sets a meta flag (for example `unwoundAt`) in the same commit as `CompensationStarted`.
    - `RESUME_EXECUTION` checks `status == failed` and that the flag is absent, atomically.
    - Delete the history read, the history-length CAS, and the `RESUME_ATTEMPTS` loop.
  - **Keep:** "resume rejected after an unwind" and concurrent resumes applying exactly once.

- [x] **4. Remove compatibility code for old history.**
  - `CompensationStarted.stepIds` becomes required.
  - Delete the `Array.isArray` normalisation in history.ts, the `stepIds.length === 0` branch in `unwind`, and the test "CompensationStarted without stepIds normalizes to empty list".
  - Remove `input` / `partitionKey` from `WorkflowStarted` fixtures in history.test.ts and index.test.ts.

- [x] **4b. Restore the visibility timeout when a wait commit reports a cancel (bug).**
  - **Found:** the flaky test "cancel during sleep then crash still compensates without waiting leftover sleep".
  - **Cause:** in `runExecution`'s `waiting` branch, `waitUntil` commits `due = fireAt`. If that commit reports a cancel, the run continues straight into the unwind on the same lease, but the due score stays at `fireAt`. The cancel's own `ZADD XX LT now` landed before the commit and was overwritten.
  - **Impact:** if the worker dies before its first heartbeat (12 s at the default `lockTTL`), the mid-unwind execution isn't reclaimed until the sleep's fire time, which could be days, instead of after `lockTTL`.
  - **Fix:** when the wait commit reports a cancel and the run continues, restore `due = now + lockTTL` before unwinding. That's one extra round trip, only on this race.
  - **Tests:** add a deterministic regression test; the flaky test must then pass reliably.

- [x] **5. One terminal guard.**
  - A terminal commit removes the execution from `due`, and every other script uses `ZADD XX` or only re-adds on resume, so `claimDue` can't return a terminal execution.
  - Keep the cheap `isTerminalStatus(meta.status)` check in `runExecution`, on meta that's already loaded.
  - Delete the `if (view.terminal) return` loop guard. It's the only reader of `view.terminal`, so `view.terminal` tracking in history.ts and the `HistoryTerminal` type go too.

- [x] **6. Make `dueAt` required on `releaseLease`.**
  - Both engine callers pass it; only the store test helper omits it. Remove the `ARGV[3] ~= ''` branch in `RELEASE_LEASE`.
  - Split `LeaseInput` into extend and release input types, so `dueAt` exists only on release.

- [x] **7. `stop()` awaits the poller loops.**
  - `start()` keeps the `workflowLoop()` promises, and `stop()` aborts the live runs then awaits `Promise.all(...)`.
  - Delete the `active` counter, the polling loop and `SHUTDOWN_POLL`.
  - First wrap the release in the "stop() raced this claim" branch in `mightThrow`, so a Redis error can't reject a loop promise.

- [x] **8. `startSync` polls meta, not `get()`.**
  - Poll `store.getMeta`. On terminal status, build the result from meta: parse `result`, and take the failure message from `originalError || error`.
  - No history read or input parse per poll.

- [ ] **9. Small cleanups.**
  - Delete the unused `RedisZMember` type.
  - `parseHistory` uses `fromJson` for each event, keeping the "not an object" check. Update any test that asserts the old message.
  - `WorkflowStartResult.status` becomes the literal `"pending"`.
  - Move `isTerminalStatus` next to its only caller, if it's still in history.ts.
  - Docs intro ([docs/workflow.md:6](docs/workflow.md#L6)): replace "automatic orphan recovery", which contradicts "There is no orphan scan" in the recovery section.

## Not doing

- **Uneven `LeaseRun<TInput>` across input types:** deliberate. Only signatures that read `run.input` need the type parameter, and a `LeaseRun<TInput>` is accepted where `LeaseRun` is expected.
- **Fold the `pending` → `running` commit into the first decision's commit:** it saves one round trip per execution, not per step, and `onStart` ordering depends on it.
- **`finishCompensation`'s unreachable `?? "workflow failed"`:** one line. Encoding it in the types would cost more than it saves.
