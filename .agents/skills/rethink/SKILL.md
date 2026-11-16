---
name: rethink
description: >-
  Assume the current implementation is wrong, recommend a design with fewer
  lines and less complexity, apply it, then re-review your own result in a
  loop until a round finds nothing left to cut. Use when the user says
  rethink, assume it's wrong, fewer lines, less complexity, simplify the
  design, shrink this, find things that don't make sense, why do we have
  both, smaller API, or asks to repeat the review on your own work.
license: MIT
---

# Rethink

Design-level simplification loop. Not a lint pass: question the shape of the code (contracts, layers, state), not just its lines. Caveman stays on.

## When to use

- User asks to assume an implementation is wrong and find a smaller design.
- A feature works but feels heavy (adapters, locks, caches, normalizers, many small files).
- User says "repeat on your own implementation" or "loop until done".

## When not to use

- Bug hunts (use code review). Style-only cleanup with no design question.
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

- Default scope: the branch diff. `git fetch origin main` first (local `main` may be behind), then `git log --oneline origin/main..HEAD`, `git diff --stat origin/main...HEAD`.
- Read every implementation file in scope, its tests, and every caller of its public types (grep imports). Callers often already do the work the module repeats.
- Inventory the surface the change adds or touches: public options, exports, types, fields on returned objects, error messages that reject an input combination, internal maps and copied fields, test fixtures and helpers, docs caveats ("X is not available with Y"). Ask of each one: why does this exist?

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
| Two ways to do one thing | Is one path a subset of the other, or tied to one runtime or vendor? | Keep the general path, delete the special one |
| Split ownership | Does the library sometimes own a resource (opens, closes, configures it) and sometimes not? | Pick one owner, usually the caller; open/close/restore branches disappear |
| Pass-through config | Is an option only forwarded to something the caller could configure directly? | Delete; the caller configures the owner |
| Recovering what you threw away | A side table or getter that re-derives data an earlier step discarded or redacted? | Stop discarding it, or stop needing it |
| Copied state | A field that mirrors an option or another field? | Read the source directly |
| Guard for an asymmetry | An error like "A needs B" or a doc caveat "C is unavailable with D"? | Remove the asymmetry; the guard, its test, and its doc line go too |
| Twin fixtures | Two test hooks or helpers that produce the same thing in different shapes? | Keep one |
| Single-use names | A local helper or constant used once, adding no meaning? | Inline |

Trace what depends on each candidate (grep callers, tests, docs). A good find removes a chain, not a line: the root choice, then every guard, type, test, and caveat that existed only because of it.

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
   `docker run -d --rm --name <tmp> -p 127.0.0.1:56379:6379 redis:8-alpine`, run with `SEMOLA_REDIS_URL=redis://127.0.0.1:56379`, then stop it.
5. Exercise any entrypoint whose lifecycle changed (CLI, server) for real, not only through tests. Ownership changes often leave a process hanging on an unclosed resource.
6. A test fails: compare against the unmodified branch before blaming or excusing your change (see Baseline). Report the flake rate on both.
7. Measure: `git diff HEAD --shortstat`, split into source (`-- src ':!*.test.ts'`) and tests (`-- '*.test.ts'`). Plain `git diff --stat` hides staged deletions. Add new untracked files: `git ls-files --others --exclude-standard -- src | xargs wc -l`.

## Step 5: Stop

Stop when a full round finds no cut that removes lines without losing behavior. Report:

1. Rounds run, one line each.
2. Net LoC, source vs tests.
3. Test and `bun check` status, including pre-existing failures with the baseline comparison.
4. Anything deliberately left as-is and why.

---

## Baseline comparison

Never use bare `git stash` (shared across worktrees). Use a detached worktree at the code from before the rethink and link dependencies instead of copying them. Before the first cut, record that state: `git stash create` snapshots tracked edits as a commit without touching the stash stack (untracked files are not included). A unique path means cleanup can only remove the worktree this run created:

```powershell
$base = git stash create
if (-not $base) { $base = git rev-parse HEAD }

$baseline = "..\<repo>-baseline-$(Get-Date -Format yyyyMMddHHmmss)"
git worktree add -q --detach $baseline $base
if ($LASTEXITCODE -ne 0) { throw "Baseline worktree was not created" }
New-Item -ItemType Junction -Path "$baseline\node_modules" -Target (Resolve-Path .\node_modules)
# run the failing test several times in both trees, compare pass rates
(Get-Item "$baseline\node_modules").Delete()   # remove the junction first
git worktree remove --force $baseline
```

Copying `node_modules` on Windows is very slow and leaves paths too long to delete.

## Guardrails

- Keep every behavior the user asked to keep ("full support"). If a cut drops a feature, it goes back to the user as a question.
- Check `git log` before each round. Someone else may commit to the branch mid-loop; say so and reconcile instead of overwriting.
- Keep public API changes in docs (`docs/<module>.md`) in the same round.
- Do not commit unless asked.
