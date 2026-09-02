---
name: harden
description: >-
  Post-feature hardening loop: blind adversarial tests (spec-only subagent),
  fix failures, slop review subagent, then deslop. Use after a feature lands,
  before merge, or when the user says harden, harden the feature, adversarial
  tests, blind test, test-then-deslop, or spin up test/deslop agents.
license: MIT
---

# Harden

Four-phase quality loop after a feature lands. Parent agent orchestrates; subagents only write tests or report slop.

## When to use

- A non-trivial feature just landed (new module, public API, migrations) and should be stress-tested before merge.
- User says: harden, harden the feature, adversarial tests, blind test, test agent, deslop agent, test-then-deslop.
- User explicitly requests the test-then-deslop subagent workflow.

## When not to use

- Tiny one-line fixes, docs-only edits, or question-only tasks.
- User only asked for a single test or a quick review (do that inline; do not launch subagents).

## Persistence

Task-triggered. Read this skill at the start of the loop and follow it through all four phases unless the user stops you.

## The loop

```
1. Blind test subagent  →  writes tests from spec only
2. Parent               →  fix failing tests (impl vs bad fixture)
3. Deslop subagent      →  report only, no edits
4. Parent               →  deslop from report, run bun check + tests
```

Do not skip phase 2 analysis. Do not let the test subagent fix implementation.

---

## Phase 1: Blind test subagent

Launch one `Task` subagent (`generalPurpose`, `run_in_background: false`).

**Rules for the subagent:**

- Do **not** read implementation under the changed area (builders, migrations, table wiring, etc.).
- May read: issue/spec, docs for the feature, 2-3 existing test files for **style only**.
- Write many adversarial tests (target ≥35 unless user gives another number).
- Do **not** fix implementation when tests fail.

**Subagent prompt must include:**

1. Feature spec / expected API (from issue or docs).
2. Exact test file paths to extend or create.
3. Test runner command, e.g. `bun test src/lib/<module>`.
4. Repo test style: `bun:test`, clear names, simple assertions (see `AGENTS.md` Testing).
5. Instruction to return: tests added, files touched, full list of failures with messages.

**Example prompt skeleton:**

```markdown
Write comprehensive tests for [FEATURE] in [REPO_PATH].

CRITICAL: Do NOT read implementation in [FORBIDDEN_PATHS]. Read only:
- [spec / docs paths]
- [1-2 test files for style]

Expected API:
[paste spec or docs excerpt]

Add tests in:
- [paths]

Run: bun test [paths]

Add at least N tests. Adversarial edge cases, migrations, error messages, ordering.

Do NOT fix implementation. Report all failures.

Return: count added, files modified, failing test names + errors.
```

---

## Phase 2: Fix failures

Parent runs the same test command. For each failure, decide:

| Cause | Action |
|-------|--------|
| Bad test fixture (missing config in `after` schema, wrong dialect assumption, invalid snapshot field) | Fix the test |
| Spec/API mismatch the implementation should meet | Fix implementation |
| Test expects behavior you intentionally rejected | Fix or delete the test; note why in summary |

Re-run until targeted tests pass, then `bun check`.

**Common blind-test traps (ORM and similar):**

- `after` table/schema missing optional callbacks present in `before` → looks like removed feature, emits extra ops.
- Expecting separate drop ops for inline constraints on `DROP TABLE`.
- Postgres/sqlite duplicate pairs when SQL comes from shared dialect code.

---

## Phase 3: Deslop subagent

Launch one `Task` subagent (`generalPurpose`, `run_in_background: false`).

**Rules:**

- Read implementation **and** tests in the feature scope.
- Compare to the nearest existing pattern in the repo (e.g. indexes parallel to checks).
- Report only — **no edits**.

**Report format (require this in the prompt):**

```markdown
## 1. Slop items
| Location | Severity | Issue | Suggested fix |

## 2. Keep as-is

## 3. Test slop
- Redundant / wrong fixture / pass-through / dialect duplicates
```

**Prompt skeleton:**

```markdown
Review [FEATURE] in [REPO_PATH] for AI slop.

Focus: [list changed files]

Compare to: [reference pattern, e.g. src/lib/orm/indexes/]

Return structured report (slop items, keep as-is, test slop). Do NOT fix anything.
```

---

## Phase 4: Deslop

Parent applies the report with minimal diffs (ponytail):

1. **High** — fix first (wrong tests, duplicate dialect pairs, dead types, unused parsers).
2. **Medium** — merge redundant tests, collapse describes, remove pass-through assertions.
3. **Low** — optional parity tweaks; skip if no clear win.

After deslop:

```bash
bun test src/lib/<module>   # or paths from phase 1
bun check
```

Do not re-run the blind test subagent unless the user asks.

---

## Semola defaults

| Item | Value |
|------|--------|
| Test command | `bun test src/lib/<module>` |
| Full gate | `bun check` |
| Subagent type | `generalPurpose` |
| Skills during parent work | ponytail + caveman (see `AGENTS.md`) |

Adjust paths and forbidden directories per feature. For ORM table constraints, forbidden paths are typically the implementation package and migration renderers; allowed spec source is `docs/orm.md` and the Linear issue.

---

## Parent summary template

After the loop, report briefly:

1. Tests added (count) and net test file change.
2. Failures fixed — implementation vs test, one line each if non-obvious.
3. Deslop — what was removed or simplified.
4. `bun test` / `bun check` status.
