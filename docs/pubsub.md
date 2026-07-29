---
title: PubSub
description: Typed Redis pub/sub channels
---

Publish and subscribe to JSON messages on a Redis channel, with TypeScript checking the payload shape.

```typescript
import { PubSub } from "semola/pubsub";
```

Needs **two** `Bun.RedisClient` connections (publisher and subscriber). Sharing one client for both is a common Redis footgun; Semola makes both explicit.

## Usage

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
// or tear everything down:
await events.unsubscribe();
```

Messages are JSON-serialized. Payloads that fail to parse are dropped. `isActive()` tells you whether the Redis subscription is live.
