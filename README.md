# semola

A TypeScript utility kit providing type-safe error handling, caching, internationalization, policy-based authorization, and developer tools.

## Installation

```bash
npm install semola
```

```bash
bun add semola
```

## Modules

- [API Framework](./docs/api.md) - Type-safe REST API framework with OpenAPI support
- [Policy](./docs/policy.md) - Type-safe policy-based authorization system
- [Internationalization (i18n)](./docs/i18n.md) - Type-safe i18n with compile-time validation
- [Cache](./docs/cache.md) - Redis cache wrapper with TTL support
- [Error Utilities](./docs/errors.md) - Result-based error handling

## Publishing

This package uses GitHub Actions to automatically publish to npm and create GitHub Releases. To release a new version:

1. Bump the version, commit, and push to `main`:

   ```bash
   bun pm version <major|minor|patch>
   git push
   ```

2. The workflow on `main` will:
   - Run `check`, `test`, and `build`
   - Publish to npm when the version in `package.json` differs from the latest on the registry
   - Create a GitHub Release and tag (e.g. `v0.4.1`) when a publish actually occurs

Authentication uses [npm Trusted Publishers](https://docs.npmjs.com/generating-provenance-statements) (OIDC); no `NPM_TOKEN` is required.

## Development

```bash
# Install dependencies
bun install

# Run type checks
bun run check

# Build package
bun run build
```
