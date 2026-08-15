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

This subscribes one handler, publishes a typed JSON message, then removes that handler.

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

This removes every local handler and the underlying Redis subscription.

Messages are JSON-serialized. Payloads that fail to parse are dropped. Handler errors are swallowed. `isActive()` tells you whether the Redis subscription is live.

Multiple handlers can share one channel; Redis unsubscribe runs when the last handler is removed.

## Async iteration

Use the `PubSub` instance as an async iterable. Each iterator buffers messages and removes its handler when the loop exits.

This loop handles each published message until it breaks or the subscription ends.

```typescript
for await (const message of events) {
  console.log(message.userId, message.action);
}
```

Use `listen({ signal })` when an `AbortSignal` should stop iteration, including a pending wait:

Aborting the request also stops this iterator and removes its temporary handler.

```typescript
for await (const message of events.listen({ signal: request.signal })) {
  console.log(message);
}
```

## Examples

### Fan-out notifications

Publishing once sends the notification to every subscribed handler on the Redis channel.

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

### Temporary handler

The handler unsubscribes itself after receiving the first logout event.

```typescript
const stop = await events.subscribe(async (message) => {
  if (message.action === "logout") {
    await stop();
  }
});
```

### Check subscription state

`isActive()` prevents creating a duplicate Redis subscription when one is already live.

```typescript
if (!events.isActive()) {
  await events.subscribe(handler);
}
```

### Async iteration with abort

The iterator consumes both messages, then the logout event aborts its pending subscription and ends the loop.

```typescript
const controller = new AbortController();

const consume = (async () => {
  for await (const message of events.listen({ signal: controller.signal })) {
    console.log(message.userId, message.action);

    if (message.action === "logout") {
      controller.abort();
    }
  }
})();

await events.publish({ userId: "123", action: "login" });
await events.publish({ userId: "123", action: "logout" });
await consume;
```

Or iterate without a signal: `for await (const message of events) { ... }`.

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
| `listen({ signal? })` | Consume buffered messages as an async iterator |
| `[Symbol.asyncIterator]()` | Iterate messages with `for await` |
| `unsubscribe()` | Remove all handlers / Redis subscription |
| `isActive()` | Whether the Redis subscription is live |
