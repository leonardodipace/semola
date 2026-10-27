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

Create a Worker connected to this repo:

| Setting | Value |
|---------|--------|
| Root directory | `apps/docs` |
| Build command | `cd ../.. && bun install && cd apps/docs && bunx opennextjs-cloudflare build` |
| Deploy command | `bunx opennextjs-cloudflare deploy` |
| Watch paths | `apps/docs/**`, `docs/**`, `package.json`, `bun.lock` |

Point `semo.la` at the Worker after the first deploy.
