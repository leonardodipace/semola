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

- [Policy](./docs/policy.md) - Type-safe policy-based authorization system
- [Internationalization (i18n)](./docs/i18n.md) - Type-safe i18n with compile-time validation
- [Cache](./docs/cache.md) - Redis cache wrapper with TTL support
- [Error Utilities](./docs/errors.md) - Result-based error handling

## Publishing

This package uses GitHub Actions to automatically publish to npm. To publish a new version:

1. Update the version in `package.json`:
   ```bash
   bun version <major|minor|patch>
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
