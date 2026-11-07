---
name: rethink
description: >-
  Assume the current implementation is wrong, recommend a design with fewer
  lines and less complexity, apply it, then re-review your own result in a
  loop until a round finds nothing left to cut. Use when the user says
  rethink, assume it's wrong, fewer lines, less complexity, simplify the
  design, shrink this, or asks to repeat the review on your own work.
license: MIT
---

# Rethink

Design-level simplification loop. Not a lint pass: question the shape of the code (contracts, layers, state), not just its lines. Caveman stays on.

## When to use

- User asks to assume an implementation is wrong and find a smaller design.
- A feature works but feels heavy (adapters, locks, caches, normalizers, many small files).
- User says "repeat on your own implementation" or "loop until done".

## When not to use

- Bug hunts (use code review). Style-only cleanup with no design question (deslop in `harden`).
- Code outside the task scope. Rethink the branch diff, not the whole repo.

## The loop

```text
Round 1  read scope -> assume wrong -> recommend (no edits) -> user decides
Round N  apply -> verify -> re-read own result -> assume wrong -> cuts?
         yes: apply and continue      no: stop, report
```

Round 1 is recommend-only because it may trade features for lines; the user picks. After the user says "loop" or "do what you gotta do", apply each later round without asking, as long as it keeps every behavior the user chose to keep.

---

## Step 1: Scope

- Default scope: the branch diff. `git log --oneline main..HEAD`, `git diff --stat main...HEAD`.
- Read every implementation file in scope, its tests, and every caller of its public types (grep imports). Callers often already do the work the module repeats.

## Step 2: Assume it is wrong

Look for these, in order of payoff:

| Smell | Question | Typical fix |
|-------|----------|-------------|
| Duplicated responsibility | Does a caller or the client library already do this (fan-out, retries, bookkeeping)? | Delete the inner copy |
| Over-strict contract | Does an interface demand a detail (a count, a shape) that forces every implementer to emulate it? | Relax the contract (`Promise<unknown>`), drop the caller check |
| Framework for few variants | Spec objects, registries, hooks for 2-3 implementations? | One small shared helper plus a few lines per variant |
| Normalizing many shapes | Parsing N reply formats at the edges? | Make the source return one canonical shape (example: Lua `EVAL` returns a flat list on every Redis client) |
| Locks and serialization | Is ordering already guaranteed (one connection, idempotent command)? | Remove the lock, leave a comment naming the guarantee |
| Global side tables | `WeakMap` or module state keyed by an object you already close over? | Closure variable |
| Leftovers from earlier rounds | Fixture params, exports, tests that only served deleted code? | Delete |
| Redundant tests | Is the assertion already covered by another suite? Did the test guard a mechanism that no longer exists? | Delete |

For each candidate, also check correctness: concurrency (overlapping calls, in-flight operations), failure rollback, double wrapping, and resource lifecycle (polling or listeners started too early).

## Step 3: Report the round

```markdown
## Rejected alternatives
- <idea>: <why it breaks or is not smaller>   (prevents flip-flopping next round)

## Cuts
1. <change> (-N lines) - <behavior kept>
2. ...

## Tradeoffs
- <anything lost or newly relied on>
```

Say plainly when the design holds and only small cuts remain. Do not invent changes to fill a round.

## Step 4: Apply and verify

1. Apply the cuts with minimal diffs. Follow `AGENTS.md` style (separate guards, no ternaries, `mightThrow`).
2. `bun test src/lib/<module>` and every module whose callers changed.
3. `bun check`.
4. Integration tests when the module talks to a server. Start a throwaway container, for example
   `docker run -d --rm --name <tmp> -p 56379:6379 redis:8-alpine`, run with `SEMOLA_REDIS_URL=redis://localhost:56379`, then stop it.
5. A test fails: compare against the unmodified branch before blaming or excusing your change (see Baseline). Report the flake rate on both.
6. Measure: `git diff HEAD --shortstat`, split into source (`-- src ':!*.test.ts'`) and tests (`-- '*.test.ts'`). Plain `git diff --stat` hides staged deletions.

## Step 5: Stop

Stop when a full round finds no cut that removes lines without losing behavior. Report:

1. Rounds run, one line each.
2. Net LoC, source vs tests.
3. Test and `bun check` status, including pre-existing failures with the baseline comparison.
4. Anything deliberately left as-is and why.

---

## Baseline comparison

Never use bare `git stash` (shared across worktrees). Use a detached worktree and link dependencies instead of copying them:

```powershell
git worktree add -q --detach ..\<repo>-baseline HEAD
New-Item -ItemType Junction -Path ..\<repo>-baseline\node_modules -Target (Resolve-Path .\node_modules)
# run the failing test several times in both trees, compare pass rates
(Get-Item ..\<repo>-baseline\node_modules).Delete()   # remove the junction first
git worktree remove --force ..\<repo>-baseline
```

Copying `node_modules` on Windows is very slow and leaves paths too long to delete.

## Guardrails

- Keep every behavior the user asked to keep ("full support"). If a cut drops a feature, it goes back to the user as a question.
- Check `git log` before each round. Someone else may commit to the branch mid-loop; say so and reconcile instead of overwriting.
- Keep public API changes in docs (`docs/<module>.md`) in the same round.
- Do not commit unless asked.
