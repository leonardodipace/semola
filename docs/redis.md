---
title: Redis
description: Semola Redis client contract, with adapters for ioredis, iovalkey, node-redis, and Valkey GLIDE
---

[Cache](/docs/cache), [Queue](/docs/queue), [PubSub](/docs/pubsub), [Cron](/docs/cron) (`CronDistributed`), and [Workflow](/docs/workflow) take a Redis client. `Bun.RedisClient` works as-is. Other clients go through an adapter from `semola/redis`. Works with Redis and Valkey servers.

| Client | Package | Pass as |
| --- | --- | --- |
| Bun | built in | `new Bun.RedisClient(url)` |
| ioredis | `ioredis` | `fromIoredis(client)` |
| iovalkey | `iovalkey` | `fromIoredis(client)` |
| node-redis | `redis` | `fromNodeRedis(client)` |
| Valkey GLIDE | `@valkey/valkey-glide` | `fromValkeyGlide(client)` |

Semola has no dependency on these packages. Adapters only rely on the client's shape.

## Import

```typescript
import { fromIoredis, fromNodeRedis, fromValkeyGlide } from "semola/redis";
```

## Quick start

This wraps an ioredis connection once and hands it to a cache and a queue.

```typescript
import { Redis } from "ioredis";
import { Cache } from "semola/cache";
import { Queue } from "semola/queue";
import { fromIoredis } from "semola/redis";

const redis = fromIoredis(new Redis(process.env.REDIS_URL));

const cache = new Cache<User>({ redis, ttl: 60_000 });

const emails = new Queue<Email>({
  name: "emails",
  redis,
  handler: sendEmail,
});
```

## Pub/sub

A subscribed connection cannot run other commands, so [PubSub](/docs/pubsub) takes two connections. Wrap each one:

```typescript
import { Redis } from "ioredis";
import { PubSub } from "semola/pubsub";
import { fromIoredis } from "semola/redis";

const events = new PubSub<UserEvent>({
  publisher: fromIoredis(new Redis()),
  subscriber: fromIoredis(new Redis()),
  channel: "user-events",
});
```

Per client:

- **ioredis / iovalkey** - use a second `new Redis()`.
- **node-redis** - use `client.duplicate()` and `connect()` it.
- **Valkey GLIDE** - create a second client without a `pubsubSubscriptions` callback. The adapter pulls messages with `getPubSubMessage()`.

Wrapping the same client again returns the same adapter, so several `PubSub` instances can share one subscriber connection.

## Other clients

Modules call `send(command, args)` for commands. A PubSub subscriber also needs `subscribe(channel, listener)` and `unsubscribe(channel, listener)`, where `subscribe` resolves to the number of subscribed channels. Any object with that shape works, as long as `send` returns decoded replies: strings, numbers, `null`, and arrays (`SCAN` as `[cursor, keys]`). `HGETALL` may be an object, a `Map`, or a flat field/value list.

```typescript
import type { RedisClient } from "semola/redis";

const redis: RedisClient = {
  send: (command, args) => myClient.command(command, ...args),
};
```

## Reference

| Export | Meaning |
| --- | --- |
| `fromIoredis(client)` | Adapter for ioredis and iovalkey |
| `fromNodeRedis(client)` | Adapter for node-redis (v4 and later) |
| `fromValkeyGlide(client)` | Adapter for a Valkey GLIDE standalone client |
| `RedisClient` | `{ send(command, args) }` - what command modules need |
| `RedisSubscriber` | `{ subscribe(channel, listener), unsubscribe(channel, listener) }` - what a PubSub subscriber needs |
| `RedisAdapter` | `RedisClient & RedisSubscriber` - what every adapter returns |
