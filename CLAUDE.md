# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Semola is a TypeScript utility kit providing modular packages for common development needs.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript 5+ (strict mode)
- **Linting/Formatting**: Biomejs
- **Testing**: Bun test
- **Schema**: Standard Schema (framework-agnostic, works with Zod, Valibot, etc.)

## Code Style

### Simplicity First

- Write minimal code, no over-engineering
- Keep code breathing with blank lines between logical blocks
- Explicit if-statements over ternaries for complex logic
- Separate if statements for early returns — no `||` combining unrelated conditions (e.g. `if (a) return; if (b) return;` not `if (a || b) return;`)
- Blank lines between if-statement groups, const definitions, and return statements inside functions
- No type predicates (`value is Type` return annotations) — use inline guards for TypeScript narrowing
- No type assertions (`as`, `!`)
- No `any` type
- Infer types, avoid explicit return types
- Use generics extensively
- Prefer separate, clearly-named `if` guards over merged conditions - no inline `&&`/`||` between unrelated checks (e.g. check `instanceof` in its own `if`, then check `.code` inside that block)
- No TypeScript type predicates (`value is Type` return annotations)

### Error Handling

- Avoid try-catch blocks, use `mightThrow` and `mightThrowSync` instead

### TypeScript

- Prefer inferred types over explicit return types
- Heavy use of generics with constraints
- Const type parameters for literal types
- For object property narrowing after a guard, prefer `?.` over extracting a local `const` — `options.validate?.(value)` not `const v = options.validate; v(value)`
- Use explicit discriminant properties for union narrowing; avoid `"flag" in obj` when all union members declare the property (the check is always true); value/truthiness checks (`obj.flag`) only work as discriminants when falsy values (`false`, `0`, `""`) are not valid states for that property
- Array-level `as const` only; no per-entry `as const` on individual object literals inside the array
- No em-dashes; use regular hyphens

### Testing

- Readable, maintainable tests
- Tests colocated with source (`*.test.ts`)
- Clear test names describing behavior
- Simple assertions without chains

## Common Commands

```bash
bun check                        # CRITICAL: lint + format + typecheck (always run before finishing)
bun test                         # Run all tests
bun test src/lib/api             # Run tests for a specific module
bun test --watch                 # Run tests in watch mode
bun run build                    # Build package
bun pm version <major|minor|patch>   # Bump version for publishing
```

## Project Structure

- Modular exports via `semola/<package-name>` (e.g., `semola/errors`, `semola/cache`)
- Each module is self-contained in its own directory under `/src/lib`
- Tests are colocated with source files (`*.test.ts`)

## Important Notes

- Don't create new docs in `/docs` unless necessary
- Keep plans concise, sacrificing grammar for brevity
- No em-dashes (—) in any code comments or documentation
