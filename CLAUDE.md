# Semola

TypeScript utility kit providing modular packages for API framework, error handling, caching, i18n, and policy-based authorization.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript 5+ (strict mode)
- **Linting/Formatting**: Biomejs
- **Testing**: Bun test
- **Schema**: Standard Schema (framework-agnostic, works with Zod, Valibot, etc.)

## Code Style

**Simplicity First**
- Write minimal code, no over-engineering
- Explicit if-statements over ternaries for complex logic
- No type assertions (`as`, `!`)
- No `any` type
- Infer types, avoid explicit return types
- Use generics extensively

**Error Handling**
- Result tuple pattern: `[error, data]` instead of throwing
- Use `ok(data)` and `err(type, message)` helpers
- Avoid try-catch blocks, use result tuples instead

**TypeScript**
- Prefer inferred types over explicit return types
- Heavy use of generics with constraints
- Const type parameters for literal types

**Testing**
- Readable, maintainable tests
- Tests colocated with source (`*.test.ts`)
- Clear test names describing behavior
- Simple assertions without chains

## Common Commands

```bash
bun check        # CRITICAL: lint + format + typecheck (always run before finishing)
bun test         # Run tests
bun run build    # Build package
```

## Project Structure

Modular exports:
- `semola/errors` - Result-based error handling
- `semola/cache` - Redis cache wrapper
- `semola/i18n` - Type-safe internationalization
- `semola/policy` - Policy-based authorization
- `semola/api` - Type-safe REST API with OpenAPI

Tests are colocated with source files (`*.test.ts`).

## Important Notes

- Don't create new docs in `/docs` unless necessary
- Each module is self-contained in its own directory
- Keep plans concise, sacrificing grammar for brevity
