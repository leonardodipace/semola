---
title: Getting Started
description: Install Semola with bun add or npm, then ship a typed REST API with OpenAPI in a few lines
---

## Install

```npm
npm install semola
```

`bun add semola` works the same. npm, pnpm, and yarn too.

Some modules use runtime-native clients (HTTP, Redis, SQL, cron). Each module page calls that out when it matters. You can start with `semola/api` and add the rest later.

## Where to go next

- [API](/docs/api) - middleware, groups, OpenAPI
- [Schema](/docs/schema) - Standard Schema validation
- [Errors](/docs/errors) - result tuples and `mightThrow`
- [Queue](/docs/queue) - Redis-backed background jobs
- [ORM](/docs/orm) - typed tables and queries

