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
- [PubSub](./docs/pubsub.md) - Type-safe Redis pub/sub for real-time messaging
- [Policy](./docs/policy.md) - Type-safe policy-based authorization system
- [Internationalization (i18n)](./docs/i18n.md) - Type-safe i18n with compile-time validation
- [Cache](./docs/cache.md) - Redis cache wrapper with TTL support
- [Error Utilities](./docs/errors.md) - Result-based error handling

## Publishing

This package uses GitHub Actions to automatically publish to npm. To publish a new version:

   ```bash
   bun version <major|minor|patch>
   ```

2. The workflow on `main` will:
   - Run `check`, `test`, and `build`
   - Publish to npm when the version in `package.json` differs from the latest on the registry
   - Create a GitHub Release and tag (e.g. `v0.4.1`) when a publish actually occurs

**Note:** This package uses npm's Trusted Publishing feature, so no NPM_TOKEN is required. The workflow authenticates using GitHub's OIDC token with the `id-token: write` permission.

## Development

```bash
# Install dependencies
bun install

# Build package
bun run build

# Build types
bun run build:types
```

## License

MIT © Leonardo Dipace

## Repository

[https://github.com/leonardodipace/semola](https://github.com/leonardodipace/semola)
