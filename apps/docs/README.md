# Semola docs

Fumadocs site for [Semola](https://github.com/leonardodipace/semola). Content lives in the repo-root `docs/` folder.

Deploys to Cloudflare Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) (Workers & Pages). Static Pages alone cannot run search, OG, or llms routes. Local `docs:preview` / `docs:deploy` need Linux or WSL; OpenNext bundling uses symlinks that fail on native Windows.

```bash
# from repo root
bun run docs:dev
bun run docs:build
bun run docs:preview   # OpenNext build + local Workers runtime
bun run docs:deploy    # OpenNext build + deploy (needs `wrangler login`)
```

## Cloudflare Git deploy (monorepo)

Worker name in the dashboard must match `wrangler.jsonc` (`semola`). Suggested Build settings:

| Setting | Value |
|---------|--------|
| Root directory | `apps/docs` |
| Build command | `cd ../.. && bun install && cd apps/docs && bunx opennextjs-cloudflare build` |
| Deploy command | `bunx opennextjs-cloudflare deploy` |
| Preview command | `bunx opennextjs-cloudflare upload` |
| Watch paths | `apps/docs/**`, `docs/**`, `package.json`, `bun.lock` |

If GitHub shows `Preview creation failed: Authentication error`, open the Worker → Settings → Build and regenerate the build API token (Workers Scripts edit). Then retry the build.

Point `semo.la` at the Worker after the first deploy.
