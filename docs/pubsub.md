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
  redis: Bun.RedisClient;
  channel: string;
};

const pubsub = new PubSub<Message>({
  redis: redisClient,
  channel: "user-events"
});
```

**`pubsub.publish(message: T)`**

Publishes a message to the channel or pattern. Returns a result tuple with the number of subscribers who received the message.

```typescript
const [error, count] = await pubsub.publish({
  userId: "123",
  action: "login",
  timestamp: Date.now()
});

if (error) {
  console.error("Failed to publish:", error.message);
} else {
  console.log(`Message delivered to ${count} subscribers`);
}
```

**`pubsub.subscribe(handler: MessageHandler<T>)`**

Subscribes to messages with a handler function. Returns a result tuple indicating success or failure.

```typescript
type MessageHandler<T> = (message: T, channel: string) => void | Promise<void>;

const [error] = await pubsub.subscribe(async (message, channel) => {
  console.log(`Received on ${channel}:`, message);
  await processMessage(message);
});

if (error) {
  console.error("Failed to subscribe:", error.message);
}
```

**`pubsub.unsubscribe()`**

Unsubscribes from the channel or pattern and cleans up the handler.

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

const events = new PubSub<UserEvent>({
  redis: new Bun.RedisClient("redis://localhost:6379"),
  channel: "user-events"
});

// Subscribe to events
await events.subscribe(async (event) => {
  console.log(`User ${event.userId} performed ${event.action}`);
  await logToDatabase(event);
});

// Publish events
await events.publish({
  userId: "123",
  action: "login",
  timestamp: Date.now()
});
```

### Error Handling

```typescript
import { PubSub } from "semola/pubsub";

const pubsub = new PubSub<string>({
  redis: new Bun.RedisClient("redis://localhost:6379"),
  channel: "notifications"
});

// Subscribe with error handling
const [subscribeError] = await pubsub.subscribe(async (message) => {
  // Handler errors are caught and logged automatically
  // Subscription remains active even if handler throws
  await processNotification(message);
});

if (subscribeError) {
  console.error("Failed to subscribe:", subscribeError.message);
  return;
}

// Publish with error handling
const [publishError, count] = await pubsub.publish("Hello!");

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
await pubsub.unsubscribe();
```

### Multiple Instances

```typescript
import { PubSub } from "semola/pubsub";

const redis = new Bun.RedisClient("redis://localhost:6379");

// Separate instances for different channels
const notifications = new PubSub<{ message: string }>({
  redis,
  channel: "notifications"
});

const alerts = new PubSub<{ level: string; text: string }>({
  redis,
  channel: "alerts"
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

**Handler Errors:** If your message handler throws an error, it will be caught and logged to `console.error`. The subscription remains active and continues processing subsequent messages.

**Lifecycle Management:** The `PubSub` class does not manage the Redis client lifecycle. You provide the client when creating the instance and are responsible for closing it when done:

```typescript
const redis = new Bun.RedisClient("redis://localhost:6379");
const pubsub = new PubSub({ redis, channel: "events" });

// Use pubsub...

// Clean up
await pubsub.unsubscribe();
await redis.quit();
```

**JSON Serialization:** Messages are automatically serialized to JSON when published and deserialized when received. This ensures type safety but means only JSON-serializable values can be sent. Attempting to publish circular references or other non-serializable values will return a `SerializationError`.

**One Handler Per Instance:** Each PubSub instance supports a single message handler. If you need multiple handlers for the same channel, create multiple PubSub instances.

**When to Use Redis Streams:** If you need message acknowledgment, guaranteed delivery, message history, or consumer groups, use Redis Streams instead of pub/sub. PubSub is best for real-time, fire-and-forget messaging where occasional message loss is acceptable.
