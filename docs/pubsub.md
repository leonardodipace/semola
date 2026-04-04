# PubSub

A type-safe Redis pub/sub wrapper for real-time messaging with result-based error handling. Built on Bun's native Redis client.

## Import

```typescript
import { PubSub } from "semola/pubsub";
```

## API

**`new PubSub<T>(options: PubSubOptions)`**

Creates a new PubSub instance for channel-based subscriptions.

```typescript
type PubSubOptions = {
  subscriber: Bun.RedisClient; // for subscribe/unsubscribe
  publisher: Bun.RedisClient; // for publish
  channel: string;
};

const pubsub = new PubSub<Message>({
  subscriber: subscriberClient,
  publisher: publisherClient,
  channel: "user-events",
});
```

Use two separate `Bun.RedisClient` instances when you both subscribe and publish on the same PubSub: a connection in subscriber mode cannot publish. Pass the same client for both when only subscribing or only publishing.

**`pubsub.publish(message: T)`**

Publishes a message to the channel or pattern. Returns a result tuple with the number of subscribers who received the message.

```typescript
const [error, count] = await pubsub.publish({
  userId: "123",
  action: "login",
  timestamp: Date.now(),
});

if (error) {
  console.error("Failed to publish:", error.message);
} else {
  console.log(`Message delivered to ${count} subscribers`);
}
```

**`pubsub.subscribe(handler: MessageHandler<T>)`**

Registers a local handler for messages on this PubSub instance. Returns a result tuple with a handler-level unsubscribe function.

```typescript
type MessageHandler<T> = (message: T, channel: string) => void | Promise<void>;

const [error, unsubscribeHandler] = await pubsub.subscribe(
  async (message, channel) => {
    console.log(`Received on ${channel}:`, message);
    await processMessage(message);
  },
);

if (error) {
  console.error("Failed to subscribe:", error.message);
}

if (unsubscribeHandler) {
  // Removes only this handler.
  await unsubscribeHandler();
}
```

**`pubsub.unsubscribe()`**

Unsubscribes all local handlers for this instance and removes the Redis subscription.

```typescript
const [error] = await pubsub.unsubscribe();

if (error) {
  console.error("Failed to unsubscribe:", error.message);
}
```

**`pubsub.isActive()`**

Returns whether the PubSub instance is currently subscribed.

```typescript
if (pubsub.isActive()) {
  console.log("Currently subscribed");
}
```

## Usage Examples

### Basic Channel Subscription

```typescript
import { PubSub } from "semola/pubsub";

type UserEvent = {
  userId: string;
  action: "login" | "logout" | "update";
  timestamp: number;
};

// Two connections: subscriber mode cannot publish
const subscriber = new Bun.RedisClient("redis://localhost:6379");
const publisher = new Bun.RedisClient("redis://localhost:6379");

const events = new PubSub<UserEvent>({
  subscriber,
  publisher,
  channel: "user-events",
});

// Subscribe to events
const [, unsubscribeEvents] = await events.subscribe(async (event) => {
  console.log(`User ${event.userId} performed ${event.action}`);
  await logToDatabase(event);
});

// Publish events
await events.publish({
  userId: "123",
  action: "login",
  timestamp: Date.now(),
});

if (unsubscribeEvents) {
  await unsubscribeEvents();
}
```

### Multiple Handlers On One Instance

```typescript
import { PubSub } from "semola/pubsub";

const subscriber = new Bun.RedisClient("redis://localhost:6379");
const publisher = new Bun.RedisClient("redis://localhost:6379");

const pubsub = new PubSub<{ text: string }>({
  subscriber,
  publisher,
  channel: "notifications",
});

const [, unsubscribeLogger] = await pubsub.subscribe(async (message) => {
  console.log("logger:", message.text);
});

const [, unsubscribeMetrics] = await pubsub.subscribe(async (message) => {
  await metrics.increment("notifications.received", { text: message.text });
});

await pubsub.publish({ text: "New alert" });

// Remove one handler, keep the other active
if (unsubscribeLogger) {
  await unsubscribeLogger();
}

// Redis unsubscribe happens only when the last local handler is removed
if (unsubscribeMetrics) {
  await unsubscribeMetrics();
}
```

### Error Handling

```typescript
import { PubSub } from "semola/pubsub";

const subscriber = new Bun.RedisClient("redis://localhost:6379");
const publisher = new Bun.RedisClient("redis://localhost:6379");

const pubsub = new PubSub<{ notification: string }>({
  subscriber,
  publisher,
  channel: "notifications",
});

// Subscribe with error handling
const [subscribeError, unsubscribeHandler] = await pubsub.subscribe(
  async (message) => {
    // Handler errors are caught automatically; subscription remains active even if handler throws
    await processNotification(message.notification);
  },
);

if (subscribeError) {
  console.error("Failed to subscribe:", subscribeError.message);
  return;
}

// Publish with error handling
const [publishError, count] = await pubsub.publish({ notification: "Hello!" });

if (publishError) {
  switch (publishError.type) {
    case "SerializationError":
      console.error("Invalid message format");
      break;
    case "PublishError":
      console.error("Redis connection failed");
      break;
  }
} else {
  console.log(`Delivered to ${count} subscribers`);
}

// Clean up
if (unsubscribeHandler) {
  await unsubscribeHandler();
}
```

### Multiple Instances

```typescript
import { PubSub } from "semola/pubsub";

const subscriber = new Bun.RedisClient("redis://localhost:6379");
const publisher = new Bun.RedisClient("redis://localhost:6379");

// Separate instances for different channels
const notifications = new PubSub<{ message: string }>({
  subscriber,
  publisher,
  channel: "notifications",
});

const alerts = new PubSub<{ level: string; text: string }>({
  subscriber,
  publisher,
  channel: "alerts",
});

await notifications.subscribe(async (msg) => {
  console.log("Notification:", msg.message);
});

await alerts.subscribe(async (msg) => {
  console.log(`Alert [${msg.level}]:`, msg.text);
});

// Publish to different channels
await notifications.publish({ message: "Welcome!" });
await alerts.publish({ level: "warning", text: "High CPU usage" });
```

## Important Notes

**No Message Persistence:** Redis pub/sub is ephemeral. Messages are delivered at-most-once and only to active subscribers. If no subscribers are connected, messages are discarded. For guaranteed delivery, consider using Redis Streams instead.

**Message Ordering:** Messages on a single channel are delivered in order. Pattern subscriptions matching multiple channels have no cross-channel ordering guarantees.

**Handler Errors:** If your message handler throws an error, it will be caught. The subscription remains active and continues processing subsequent messages.

**Lifecycle Management:** The `PubSub` class does not manage the Redis client lifecycle. You provide the clients when creating the instance and are responsible for closing them when done:

```typescript
const subscriber = new Bun.RedisClient("redis://localhost:6379");
const publisher = new Bun.RedisClient("redis://localhost:6379");
const pubsub = new PubSub({ subscriber, publisher, channel: "events" });

// Use pubsub...

// Clean up
await pubsub.unsubscribe();
await subscriber.quit();
await publisher.quit();
```

**Subscriber Mode and Publish:** A Redis connection in subscriber mode (after `SUBSCRIBE`) cannot run `PUBLISH`. Use two connections (`subscriber` for subscribe/unsubscribe, `publisher` for publish) when the same PubSub instance both subscribes and publishes. The same client can be passed for both when only subscribing or only publishing.

**JSON Serialization:** Messages are automatically serialized to JSON when published and deserialized when received. This ensures type safety but means only JSON-serializable values can be sent. Attempting to publish circular references or other non-serializable values will return a `SerializationError`.

**Multiple Local Handlers:** A single PubSub instance can have multiple active handlers. Internally, it keeps one Redis subscription per channel per instance and fans out each message to every active local handler.

**Handler-Level Unsubscribe:** Each successful `subscribe()` call returns a dedicated unsubscribe function for that handler only. Other handlers remain active.

**Last Handler Cleanup:** Redis-level `unsubscribe` runs only when the final local handler is removed (or when `pubsub.unsubscribe()` is called to clear all handlers).

**When to Use Redis Streams:** If you need message acknowledgment, guaranteed delivery, message history, or consumer groups, use Redis Streams instead of pub/sub. PubSub is best for real-time, fire-and-forget messaging where occasional message loss is acceptable.
