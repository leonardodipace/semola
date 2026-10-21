---
title: Schema
description: Zero-dependency Standard Schema validation
---

Type-safe schemas for runtime validation. Compatible with [Standard Schema](https://standardschema.dev/), so the same objects work with `semola/api`, `semola/cli`, and other Standard Schema consumers. Also emits JSON Schema for OpenAPI.

## Import

Named helpers tree-shake cleanly. `s` is the same API as one object (handy; less tree-shake friendly if you only need a few builders).

```typescript
import {
  string,
  number,
  int,
  email,
  uuid,
  boolean,
  object,
  array,
  optional,
  parse,
  safeParse,
} from "semola/schema";

// or
import { s } from "semola/schema";
```

## Quick start

Define a shape, then `parse` (throws `SchemaError`) or `safeParse` (result object). Format helpers (`email`, `url`, `uuid`, `int`) are top-level like Zod v4; method forms (`string().email()`) still work.

```typescript
import { s } from "semola/schema";

const User = s.object({
  email: s.email(),
  id: s.uuid(),
  age: s.int().min(0),
  nickname: s.string().min(1).optional(),
});

const user = User.parse({
  email: "ada@example.com",
  id: "550e8400-e29b-41d4-a716-446655440000",
  age: 36,
});
```

## With semola/api

Pass schemas anywhere the API expects a Standard Schema (body, query, params, responses).

```typescript
import { Api } from "semola/api";
import { email, object, string } from "semola/schema";

const api = new Api();

api.defineRoute({
  path: "/users/:id",
  method: "GET",
  request: {
    params: object({ id: string() }),
  },
  response: {
    200: object({ id: string(), email: email() }),
  },
  handler: async (c) => {
    return c.json(200, {
      id: c.req.params.id,
      email: "hi@semola.dev",
    });
  },
});
```

## Primitives

| Helper | Output |
| --- | --- |
| `string()` | `string` |
| `number()` | `number` (finite) |
| `boolean()` | `boolean` |
| `bigint()` | `bigint` |
| `date()` | `Date` |
| `literal(value)` | that literal |
| `enumValues(["a", "b"])` | union of members |
| `nullType()` | `null` |
| `undefinedType()` | `undefined` |
| `any()` / `unknown()` | `unknown` |
| `never()` | never succeeds |

### Formats (top-level)

| Helper | Same as |
| --- | --- |
| `email()` | `string().email()` |
| `url()` | `string().url()` |
| `uuid()` | `string().uuid()` |
| `int()` | `number().int()` |

### String checks

Chain on `string()`: `min`, `max`, `length`, `regex`, `email`, `url`, `uuid`, `startsWith`, `endsWith`, `includes`.

### Number checks

Chain on `number()`: `min`, `max`, `int`, `positive`, `nonnegative`.

## Objects and collections

```typescript
import {
  object,
  array,
  record,
  tuple,
  union,
  string,
  number,
  boolean,
  literal,
} from "semola/schema";

object({
  tags: array(string()).min(1),
  scores: record(number()),
  point: tuple([number(), number()]),
  flag: union([boolean(), literal("maybe")]),
});
```

Unknown object keys are kept (validated objects return the same reference). Missing required keys fail validation.

## Optional, nullable, nullish

```typescript
optional(string()); // string | undefined
nullable(string()); // string | null
nullish(string()); // string | null | undefined

string().optional();
string().nullable();
string().nullish();
```

In `object({...})`, keys typed with `optional` / `nullish` are not required.

## Refine

```typescript
number().refine((value) => value % 2 === 0, "Expected even");
```

## Infer types

```typescript
import type { InferOutput, InferInput } from "semola/schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";

type User = InferOutput<typeof User>;
type UserInput = InferInput<typeof User>;

// Same types via Standard Schema helpers (keys off ~standard.types)
type UserStd = StandardSchemaV1.InferOutput<typeof User>;
```

## Performance

Validation is sync-only and allocation-light on the success path (shared path/issue buffers, compiled object checks). Object schemas return the input object; each `safeParse` / `~standard.validate` success result is a fresh wrapper.

## Standard Schema and JSON Schema

Every schema exposes `~standard` (`version: 1`, `vendor: "semola"`, sync `validate`) and `~standard.jsonSchema` for `draft-2020-12`. `date()` and `bigint()` support output JSON Schema only - input conversion throws because JSON has no `Date` or `bigint`, including when nested under `object`, `array`, `union`, and the other composites. `undefinedType()`, `literal(NaN)` / non-finite numbers, and `literal(bigint)` also throw on JSON Schema conversion. `regex()` with flags other than `g`/`y` omits `pattern` from JSON Schema (JSON Schema has no flags).

```typescript
const result = User["~standard"].validate(user);
const jsonSchema = User.toJsonSchema();
```

## Errors

`parse` throws `SchemaError` with `issues` (Standard Schema issue objects, including `path`). `safeParse` returns `{ success: true, data }` or `{ success: false, error: { issues, message } }`.
