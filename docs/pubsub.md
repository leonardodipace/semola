---
title: PubSub
description: Typed Redis pub/sub channels
---

Publish and subscribe to JSON messages on a Redis channel, with TypeScript checking the payload shape.

Needs **two** `Bun.RedisClient` connections (publisher and subscriber). Sharing one client for both is a common Redis footgun; Semola makes both explicit.

## Import

```typescript
import { PubSub } from "semola/pubsub";
```

## Quick start

```typescript
type UserEvent = {
  userId: string;
  action: "login" | "logout";
};

const events = new PubSub<UserEvent>({
  subscriber: redisSubscriber,
  publisher: redisPublisher,
  channel: "user-events",
});

const unsubscribe = await events.subscribe(async (message, channel) => {
  console.log(channel, message.userId, message.action);
});

await events.publish({
  userId: "123",
  action: "login",
});

await unsubscribe();
```

## Subscriptions

`subscribe` returns an unsubscribe function for that handler. Or tear everything down with `events.unsubscribe()`.

```typescript
await events.unsubscribe();
```

Messages are JSON-serialized. Payloads that fail to parse are dropped. Handler errors are swallowed. `isActive()` tells you whether the Redis subscription is live.

Multiple handlers can share one channel; Redis unsubscribe runs when the last handler is removed.

## Examples

### Example: Fan-out notifications

```typescript
const notify = new PubSub<{ userId: string; text: string }>({
  subscriber: redisSubscriber,
  publisher: redisPublisher,
  channel: "notifications",
});

await notify.subscribe(async (message) => {
  await pushToDevice(message.userId, message.text);
});

await notify.publish({ userId: "u1", text: "Welcome!" });
```

### Example: Temporary handler

```typescript
const stop = await events.subscribe(async (message) => {
  if (message.action === "logout") {
    await stop();
  }
});
```

### Example: Check subscription state

```typescript
if (!events.isActive()) {
  await events.subscribe(handler);
}
```

## Reference

| Option | Meaning |
| --- | --- |
| `subscriber` | `Bun.RedisClient` used for subscribe |
| `publisher` | `Bun.RedisClient` used for publish |
| `channel` | Redis channel name |

### Methods

| Method | Meaning |
| --- | --- |
| `publish(message)` | Publish a JSON message |
| `subscribe(handler)` | Add a handler; returns unsubscribe fn |
| `unsubscribe()` | Remove all handlers / Redis subscription |
| `isActive()` | Whether the Redis subscription is live |
