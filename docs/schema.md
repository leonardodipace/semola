---
title: Schema
description: Zero-dependency Standard Schema validation
---

Type-safe schemas for runtime validation. Compatible with [Standard Schema](https://standardschema.dev/), so the same objects work with `semola/api`, `semola/cli`, and other Standard Schema consumers. Also emits JSON Schema for OpenAPI.

## Import

```typescript
import {
  string,
  number,
  boolean,
  object,
  array,
  optional,
  parse,
  safeParse,
} from "semola/schema";
```

## Quick start

Define a shape, then `parse` (throws `SchemaError`) or `safeParse` (result tuple-style object).

```typescript
import { object, string, number, optional } from "semola/schema";

const User = object({
  email: string().email(),
  age: number().int().min(0),
  nickname: optional(string().min(1)),
});

const user = User.parse({
  email: "ada@example.com",
  age: 36,
});
```

## With semola/api

Pass schemas anywhere the API expects a Standard Schema (body, query, params, responses).

```typescript
import { Api } from "semola/api";
import { object, string } from "semola/schema";

const api = new Api();

api.defineRoute({
  path: "/users/:id",
  method: "GET",
  request: {
    params: object({ id: string() }),
  },
  response: {
    200: object({ id: string(), email: string().email() }),
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

### String checks

Chain on `string()`: `min`, `max`, `length`, `regex`, `email`, `url`, `startsWith`, `endsWith`, `includes`.

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

type User = InferOutput<typeof User>;
type UserInput = InferInput<typeof User>;
```

## Performance

Validation is sync-only and allocation-light on the success path (shared buffers, compiled object checks, same-reference outputs). Success results from `~standard.validate` / `safeParse` reuse a pooled object - read `.value` / `.data` before the next call on the same thread.

## Standard Schema and JSON Schema

Every schema exposes `~standard` (`version: 1`, `vendor: "semola"`, sync `validate`) and `~standard.jsonSchema` for `draft-2020-12`, `draft-07`, and `openapi-3.0`.

```typescript
const result = User["~standard"].validate(data);
const jsonSchema = User.toJsonSchema();
```

## Errors

`parse` throws `SchemaError` with `issues` (Standard Schema issue objects, including `path`). `safeParse` returns `{ success: true, data }` or `{ success: false, error: { issues, message } }`.
