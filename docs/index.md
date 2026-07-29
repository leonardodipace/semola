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

| You need… | Start here |
| --- | --- |
| HTTP APIs with OpenAPI | [API](/docs/api) |
| Background jobs | [Queue](/docs/queue) |
| Durable multi-step work | [Workflow](/docs/workflow) |
| SQL / SQLite data access | [ORM](/docs/orm) |
| Authorization rules | [Policy](/docs/policy) |
| Errors without try/catch | [Errors](/docs/errors) |

Also available: [PubSub](/docs/pubsub), [Cron](/docs/cron), [Cache](/docs/cache), [i18n](/docs/i18n), [Logging](/docs/logging), [CLI](/docs/cli), [Prompts](/docs/prompts), and [Extra](/docs/extra) helpers.

## Next step

[Getting Started](/docs/getting-started) walks through install and a small working API.
