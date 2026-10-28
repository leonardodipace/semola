---
title: Introduction
description: Semola replaces a stack of backend libraries with one zero-dependency TypeScript package - typed APIs, queues, ORM, workflows, and more
---

Most backends start as a pile of packages: a router, a queue, an ORM, a validator, maybe an OpenAPI generator. Types almost line up. Semola is the alternative - one TypeScript package with an empty dependencies field. Install once, import only what you need:

```typescript
import { Api } from "semola/api";
import { mightThrow } from "semola/errors";
import { Queue } from "semola/queue";
```

Validation works with [`semola/schema`](/docs/schema) or any [Standard Schema](https://standardschema.dev/) library (Zod, Valibot, ArkType, and others).

## What you can build with

### HTTP & Jobs

| You need… | Start here |
| --- | --- |
| HTTP APIs with OpenAPI | [API](/docs/api) |
| Background jobs | [Queue](/docs/queue) |
| Typed real-time channels | [PubSub](/docs/pubsub) |
| Scheduled tasks | [Cron](/docs/cron) |
| Durable multi-step work | [Workflow](/docs/workflow) |

### Data & Auth

| You need… | Start here |
| --- | --- |
| SQL / SQLite data access | [ORM](/docs/orm) |
| Redis caching | [Cache](/docs/cache) |
| Authorization rules | [Policy](/docs/policy) |
| Typed translations | [i18n](/docs/i18n) |

### Utilities

| You need… | Start here |
| --- | --- |
| Runtime schema validation | [Schema](/docs/schema) |
| Errors without try/catch | [Errors](/docs/errors) |
| Prefixed console or file logs | [Logging](/docs/logging) |
| Interactive terminal input | [Prompts](/docs/prompts) |
| Typed command-line programs | [CLI](/docs/cli) |
| Small general-purpose helpers | [Extra](/docs/extra) |

## Next step

[Getting Started](/docs/getting-started) walks through install and a small working API.
