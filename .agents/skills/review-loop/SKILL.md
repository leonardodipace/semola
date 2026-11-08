---
name: review-loop
description: >-
  Alternate code review and rethink on the current change until a review round
  finds nothing new worth fixing and the rethink after it finds nothing to cut.
  Use after a feature lands, before merge, or when the user says review loop,
  code review + rethink, run the loop, keep going until clean, or harden.
license: MIT
---

# Review loop

Review finds bugs, rethink removes complexity, and each fix can create new bugs. Run both in turns until a full round comes back clean. Caveman stays on for prose.

## When to use

- A non-trivial feature or refactor is done and should be solid before merge.
- User asks for "code review + rethink", "the loop", "keep going until clean", or "harden".

## When not to use

- One-line fixes, docs-only edits, questions.
- A single quick review (run code review once, no loop).

## The loop

```text
1. Review    -> findings (pass the decided list so repeats do not count)
2. Triage    -> fix / reject with a reason / ask the user
3. Fix       -> reproduce, fix, add a test that fails without the fix
4. Verify    -> targeted tests, bun check, real runtime when it matters
5. Rethink   -> assume the design is wrong, cut what no longer earns its lines
6. Repeat from 1
```

Stop only when a review round has no new actionable finding **and** the rethink after it has no cut. One review plus one rethink is not the loop. Do not report "done" after the first clean-looking round; the next review usually finds more.

---

## Step 1: Review

- Use the `code-review` skill at `high` effort when available. Otherwise launch one review subagent over the whole change (`git fetch origin main`, then `git diff origin/main...HEAD` for commits, `git diff HEAD` for staged and unstaged edits, plus untracked files) and ask for findings with file, line, summary, and a concrete failure scenario.
- Review every changed file: docs, skills, and config too, not only the module. Files written late (a skill or doc added after the code settled) still get at least one round.
- From round 2 on, pass a **decided list**: every finding already rejected or intentionally accepted, one line each with the reason. Ask the reviewer not to re-report them. The list only grows.
- Each decided item names the exact behavior accepted, never a whole area of code. "Route sorting costs a little at compile time" is an item; "the route sort" tells later reviewers to skip it and hides bugs in it.
- After the first few rounds, add a severity focus to the prompt: "bugs a real user would plausibly hit (crashes, hangs, wrong routing, data loss, security); skip exotic edge cases and style."

## Step 2: Triage

For each finding pick one:

| Verdict | When |
|---------|------|
| Fix | A real user would hit it, or it is a clear, cheap correctness fix |
| Reject | Exotic edge case, style only, pre-existing and out of scope, false positive, or contradicts an earlier decision. Write the reason; it goes on the decided list |
| Ask the user | The fix trades away a feature or changes public behavior the user cares about |

Rules:

- **Verify before fixing.** Reproduce the finding (script, test, real runtime). Reviewers produce false positives; check claims like "this type was removed" against the source.
- **Raise the bar as rounds go on.** Fixing every edge case keeps the loop going forever. Late rounds should mostly reject.
- **Do not re-litigate.** A decided item stays decided unless new evidence shows real users hit it.

## Step 3: Fix

- Minimal diff, repo style (`AGENTS.md`).
- Every fix gets a test that fails without it. When behavior depends on a runtime or platform, test it there (example: a Node adapter tested under real `node`, not only Bun's `node:http` emulation; spawn `node` on a `Bun.build` bundle and `skipIf` node is missing).
- A test that encoded the old wrong behavior gets rewritten, not deleted silently.
- A change made for speed or size is still a behavior change. Write down the reasoning that makes it safe ("routes of different lengths never match the same path") and test the cases that reasoning rules out. If one of them breaks, so does the reasoning.

## Step 4: Verify

1. `bun test src/lib/<module>` and every module whose callers changed.
2. `bun check`.
3. Real runtime or integration checks when the fix is about runtime behavior.
4. Hot path touched: micro-benchmark against a baseline worktree (see Baseline). A "small" structural change (sorting routes, an extra decode) can cost 15-50%.

## Step 5: Rethink

Run the `rethink` skill on the current diff, applying cuts without asking (the user asked for the loop), except cuts that drop a feature.

On top of the usual smells, ask each round:

- **Is a past decision still working out?** If one mechanism keeps producing findings round after round, the mechanism is the problem, not the individual bugs. Re-evaluate it from scratch and say what changed your mind. Example: streaming request bodies kept producing keep-alive edge cases; buffering removed the whole class. Example of the opposite: a shared router looked like it was "rebuilding Bun's router", but the added behavior was needed by the other runtimes anyway, so it stayed.
- **Did my own fixes introduce bugs?** Re-read code written in earlier rounds as if someone else wrote it. Fixes for one finding often create the next one (an encoding fix that turned `//admin` into a host).
- **Do tests still guard something that exists?** Delete tests that only covered a removed mechanism.

## Step 6: Repeat

Go back to step 1 with the updated decided list. Keep a one-line log per round (what was fixed, what was rejected).

Once the loop stops, get one review from a different reviewer before merge: the `pr-review` skill, or CodeRabbit on the PR. Rounds by the same reviewer share blind spots, and the decided list narrows what it looks at.

---

## Baseline

Never use bare `git stash` (shared across worktrees). For regressions and benchmarks, use a detached worktree at the code from before the change, with a linked `node_modules`. The merge base with `origin/main` is that code whether the change is committed or not; a unique path means cleanup can only remove the worktree this run created:

```powershell
git fetch -q origin main
$base = git merge-base origin/main HEAD
$baseline = "..\<repo>-baseline-$(Get-Date -Format yyyyMMddHHmmss)"
git worktree add -q --detach $baseline $base
if ($LASTEXITCODE -ne 0) { throw "Baseline worktree was not created" }
New-Item -ItemType Junction -Path "$baseline\node_modules" -Target (Resolve-Path .\node_modules)
# run the same script in both trees, alternate runs, compare medians
(Get-Item "$baseline\node_modules").Delete()
git worktree remove --force $baseline
```

Load tests run from a single-threaded client (autocannon) are usually client-bound on a dev machine; prefer in-process micro-benchmarks or server CPU per request, and say when numbers are within noise.

## Report

Once, at the end:

1. Rounds run, one line each: fixed, rejected, decisions revisited.
2. Behavior changes worth a PR note.
3. Net LoC: source vs tests vs docs.
4. Test and `bun check` status, plus anything verified on a real runtime.

Do not commit unless asked.
