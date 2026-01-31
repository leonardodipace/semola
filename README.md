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
- [Queue](./docs/queue.md) - Redis-backed job queue with timeouts, concurrency, and graceful shutdown
- [Policy](./docs/policy.md) - Type-safe policy-based authorization system
- [Internationalization (i18n)](./docs/i18n.md) - Type-safe i18n with compile-time validation
- [Cache](./docs/cache.md) - Redis cache wrapper with TTL support
- [PubSub](./docs/pubsub.md) - Redis pub/sub for real-time messaging
- [Error Utilities](./docs/errors.md) - Result-based error handling

## Publishing

This package uses GitHub Actions to automatically publish to npm and create GitHub Releases. To release a new version:

1. Bump the version, commit, and push to `main`:

1. Update the version in `package.json`:

   ```bash
   bun pm version <major|minor|patch>
   git push
   ```

2. Create a new release on GitHub:
   - Go to the [Releases page](https://github.com/leonardodipace/semola/releases)
   - Click "Create a new release"
   - Create a new tag (e.g., `v0.3.0`)
   - Publish the release

The GitHub Action will automatically:

- Run checks and tests
- Build the package
- Publish to npm with provenance

Alternatively, you can manually trigger the workflow from the Actions tab and optionally specify a version.

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
