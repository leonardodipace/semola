---
title: Introduction
description: Zero-dependency TypeScript utilities for backends
---

Semola is a toolkit of small, type-safe packages for building backends. Install once, then import only the pieces you need:

```typescript
import { Api } from "semola/api";
import { mightThrow } from "semola/errors";
import { Queue } from "semola/queue";
```

No runtime dependencies. Validation works with any [Standard Schema](https://standardschema.dev/) library (Zod, Valibot, ArkType, and others).

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
| Errors without try/catch | [Errors](/docs/errors) |
| Prefixed console or file logs | [Logging](/docs/logging) |
| Interactive terminal input | [Prompts](/docs/prompts) |
| Typed command-line programs | [CLI](/docs/cli) |
| Small general-purpose helpers | [Extra](/docs/extra) |

## Next step

[Getting Started](/docs/getting-started) walks through install and a small working API.
