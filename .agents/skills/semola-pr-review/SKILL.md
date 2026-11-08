---
name: semola-pr-review
description: >-
  One fresh, whole-PR review in the style of CodeRabbit: a subagent with no
  session context reads every file changed against the merge base, hunts for
  claims the code relies on, verifies findings by running them, and reports
  ranked findings without editing. Use before merge, after semola-review stops,
  or when the user says PR review, fresh review, second opinion, or "our own
  coderabbit".
license: MIT
---

# Semola PR review

A second reviewer with different blind spots. `semola-review` loops with the same reviewer and a decided list that narrows what it looks at; this skill runs once, from scratch, over the whole PR. Caveman stays on for prose.

## Why it finds different bugs

| Loop reviewer | PR reviewer |
|---------------|-------------|
| Knows the session, the decisions, the history | Knows nothing; reads the diff cold |
| Told what not to re-report | No decided list |
| Reviews the module being worked on | Reviews every changed file: code, tests, docs, skills, config |
| Trusts comments that explain why code is safe | Treats every "never", "always", "can't" as a claim to break |

## Step 1: Scope

```bash
base=$(git merge-base main HEAD)
git diff --stat "$base"            # commits plus staged and unstaged edits
git ls-files --others --exclude-standard
```

All of it is in scope, whether committed or not.

## Step 2: Launch one fresh subagent

Use the Agent tool with a general-purpose subagent, in the foreground. Do not fork: a fork inherits the session and its blind spots. Give it only the prompt below with the placeholders filled in. No summary of the session, no decided list, no hints about what was already fixed.

```markdown
Review this pull request in [REPO_PATH] as a senior reviewer who has never seen it.

Scope: every file changed between [BASE_SHA] and the working tree, including
untracked files: [FILE LIST]. Read AGENTS.md first for repo conventions.
Do not edit any repo file. Put scratch scripts in a new temp directory outside
the repo.

For each file:
1. Read the full new version, not only the hunks, plus the callers of anything
   whose behavior changed.
2. Claims: list every assumption the code or its comments rely on ("X never
   happens", "these two cannot both match", "this always runs first", "HEAD is
   the old code"). Try to build a counterexample for each.
3. Boundaries: empty and maximum inputs, ordering and overlap (two rules that
   match the same input), concurrency and in-flight work, failure and cleanup
   paths, behavior on each supported runtime or platform.
4. Tests: which cases from 2 and 3 have no test?
5. Docs, skills, and scripts are code: would following them break something
   (destructive commands, wrong assumptions about git state or the OS,
   instructions that skip part of the change)? Do docs match the code?

Verify every finding you can by running it: a script, a test, or a command.
Mark each finding verified (with what you ran) or reasoned.

Report, most severe first, as JSON:
[{ "file", "line", "severity": "major|minor", "category",
   "summary", "failure_scenario", "verified", "fix" }]
major = a real user or contributor would hit it. minor = real but unlikely.
Skip style and naming unless a repo convention in AGENTS.md is broken.
If nothing survives verification, return [] and say what you checked.
```

## Step 3: Triage

Triage the findings with the rules from `semola-review` (verify, fix or reject with a reason, ask the user about feature trades). Then:

- Every fix gets a test that fails without it.
- `bun test` for touched modules and `bun check`.
- Do not run this skill again on the fixes. If they are large, run one `semola-review` round on them instead.

## Report

1. Findings: fixed, rejected (with reason), or asked.
2. What the reviewer verified by running versus reasoned.
3. Test and `bun check` status.

Do not commit or reply on the PR unless asked.
