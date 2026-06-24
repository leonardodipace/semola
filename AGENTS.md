# AGENTS.md

Guidance for AI agents working in this repository.

## Overview

Semola is a zero-dependency TypeScript utility library for Bun: type-safe APIs, queues, pub/sub, caching, i18n, auth, workflows, ORM, and more. Each package is tree-shakeable via `semola/<package-name>` imports.

## Workflow

1. Read relevant skill files before coding (see below).
2. Keep diffs minimal and scoped to the task.
3. Run targeted tests: `bun test src/lib/<module>`.
4. Run `bun check` before finishing (lint, format, typecheck).
5. Add or update docs in `/docs` when adding a module or changing public API (see Documentation).
6. Do not commit or push unless explicitly asked.

## Agent Skills

Read each skill file and follow its instructions.

| Skill | When | Path |
|-------|------|------|
| **ponytail** | Default for all implementation work | `.agents/skills/ponytail/SKILL.md` |
| **caveman** | Default for communication (terse, accurate) | `.agents/skills/caveman/SKILL.md` |
| **fallow** | Audits, cleanup, PR risk, code health | `.agents/skills/fallow/SKILL.md` |

Ponytail and caveman are always on. Fallow is task-triggered. Caveman affects prose only - never reduce code quality, test coverage, or correctness.

Run fallow with `bunx fallow` (no install or dev dependency needed). Example: `bunx fallow audit --base main --format json --quiet 2>/dev/null || true`. See the fallow skill for commands and flags.

## Repo Constraints

- **Zero runtime dependencies** - do not add packages without strong reason.
- **Imports** - use `.js` extensions in TypeScript imports (`from "./types.js"`).
- **Module layout** - each package under `src/lib/<name>/` typically has `index.ts`, `types.ts`, `errors.ts`, and colocated `*.test.ts`.
- **Errors** - use `mightThrow` / `mightThrowSync` from `semola/errors`; define module-specific error classes in `errors.ts`.
- **Validation** - Standard Schema in library code, not Zod-specific APIs.
- **Build** - `tsdown` (not tsc for output).

## Packages

Modules live in `src/lib/<name>/` and export via `semola/<name>`. Discover the current set from `package.json` exports and `src/lib/` - do not maintain a static list here.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript 5+ (strict mode)
- **Linting/Formatting**: Biomejs
- **Testing**: Bun test
- **Schema**: Standard Schema (framework-agnostic, works with Zod, Valibot, etc.)

## Code Style

### Simplicity

- Write minimal code, no over-engineering.
- Keep code breathing with blank lines between logical blocks.
- Explicit `if` statements over ternaries for complex logic.
- Blank lines between if-statement groups, const definitions, and return statements inside functions.
- No `any` type. Infer types, avoid explicit return types. Use generics extensively.
- No type predicates (`value is Type` return annotations) - use inline guards for narrowing.
- No em-dashes; use regular hyphens.

### Guards and control flow

Separate unrelated checks into their own `if` statements:

```typescript
// bad
if (value instanceof Error && value.code === "ENOENT") return;

// good
if (!(value instanceof Error)) return;
if (value.code === "ENOENT") return;
```

Same for early returns - no `||` combining unrelated conditions:

```typescript
// bad: if (a || b) return;
// good: if (a) return; if (b) return;
```

### Error handling

Use `mightThrow` / `mightThrowSync` from `semola/errors` instead of try-catch:

```typescript
const [error, data] = await mightThrow(fetch(url));
if (error) throw new FetchError(error.message);
```

### TypeScript edge cases

- Const type parameters for literal types.
- After a guard, prefer `?.` over extracting a local - `options.validate?.(value)` not `const v = options.validate; v(value)`.
- Use explicit discriminant properties for union narrowing.
- Avoid `"flag" in obj` when all union members declare the property (the check is always true).
- Truthiness checks (`obj.flag`) only work as discriminants when falsy values (`false`, `0`, `""`) are not valid states.
- Array-level `as const` only; no per-entry `as const` on individual object literals inside the array.

### Testing

- Colocate tests with source (`*.test.ts`).
- Clear test names describing behavior.
- Simple assertions without chains.

## Commands

```bash
bun check                        # lint + format + typecheck (always run before finishing)
bun test                         # run all tests
bun test src/lib/api             # run tests for a specific module
bun test --watch                 # watch mode
bun run build                    # build package
bun pm version <major|minor|patch>   # bump version for publishing
bunx fallow audit --base main --format json --quiet 2>/dev/null || true   # changed-code audit
```

## Documentation

- New modules need a doc at `docs/<module>.md` (match existing module docs in `/docs`).
- Update existing docs when public API, behavior, or usage changes.
- Skip docs only for internal refactors with no user-facing change.

## Boundaries

- Do not add runtime dependencies.
- Do not commit or push unless explicitly asked.
- Do not refactor unrelated code while fixing a bug.
- Keep plans concise.
- No em-dashes in code comments or documentation.
