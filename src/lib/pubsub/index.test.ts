import { describe, expect, test } from "bun:test";
import { PubSub } from "./index.js";

type Handler = (message: string, channel: string) => void | Promise<void>;

class MockRedisClient {
  private subscriptions = new Map<string, Handler>();
  private shouldFail = false;

  public setShouldFail(value: boolean) {
    this.shouldFail = value;
  }

  public async publish(channel: string, message: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    let count = 0;

    // Trigger exact channel subscriptions
    const channelHandler = this.subscriptions.get(channel);

    if (channelHandler) {
      await channelHandler(message, channel);
      count++;
    }

    return count;
  }

  public async subscribe(channel: string, handler: Handler) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    this.subscriptions.set(channel, handler);
  }

  public async unsubscribe(channel: string) {
    if (this.shouldFail) {
      throw new Error("Redis connection error");
    }

    this.subscriptions.delete(channel);
  }

  public clear() {
    this.subscriptions.clear();
  }

  public getSubscriptions() {
    return this.subscriptions;
  }
}

const createMockRedis = () => {
  return new MockRedisClient() as MockRedisClient & Bun.RedisClient;
};

describe("PubSub", () => {
  describe("Channel mode", () => {
    test("should publish and receive messages", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<{ userId: string; action: string }>({
        subscriber: redis,
        publisher: redis,
        channel: "user-events",
      });

      const messages: Array<{ userId: string; action: string }> = [];

      const [subscribeError] = await pubsub.subscribe(async (message) => {
        messages.push(message);
      });

      expect(subscribeError).toBeNull();
      expect(pubsub.isActive()).toBe(true);

      const [publishError, count] = await pubsub.publish({
        userId: "123",
        action: "login",
      });

      expect(publishError).toBeNull();
      expect(count).toBe(1);

      // Wait for async message handling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ userId: "123", action: "login" });
    });

    test("should receive channel name in handler", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test-channel",
      });

      let receivedChannel = "";

      await pubsub.subscribe(async (_message, channel) => {
        receivedChannel = channel;
      });

      await pubsub.publish("test message");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(receivedChannel).toBe("test-channel");
    });

    test("should unsubscribe cleanly", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      await pubsub.subscribe(async () => {});

      expect(pubsub.isActive()).toBe(true);

      const [error] = await pubsub.unsubscribe();

      expect(error).toBeNull();
      expect(pubsub.isActive()).toBe(false);
      expect(redis.getSubscriptions().size).toBe(0);
    });

    test("should return error when subscribing twice", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      const [error1] = await pubsub.subscribe(async () => {});

      expect(error1).toBeNull();

      const [error2] = await pubsub.subscribe(async () => {});

      expect(error2).toEqual({
        type: "SubscribeError",
        message: "Already subscribed",
      });
    });

    test("should return error when unsubscribing without subscription", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      const [error] = await pubsub.unsubscribe();

      expect(error).toEqual({
        type: "UnsubscribeError",
        message: "Not subscribed",
      });
    });

    test("should handle multiple publish/subscribe cycles", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<number>({
        subscriber: redis,
        publisher: redis,
        channel: "numbers",
      });

      // First cycle
      let count1 = 0;

      await pubsub.subscribe(async () => {
        count1++;
      });

      await pubsub.publish(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await pubsub.unsubscribe();

      expect(count1).toBe(1);

      // Second cycle
      let count2 = 0;

      await pubsub.subscribe(async () => {
        count2++;
      });

      await pubsub.publish(2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await pubsub.unsubscribe();

      expect(count2).toBe(1);
      expect(count1).toBe(1); // Previous handler should not be called
    });
  });

  describe("Multiple channels", () => {
    test("should not receive messages from different channels", async () => {
      const redis = createMockRedis();

      const pubsub1 = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "channel1",
      });

      const messages: string[] = [];

      await pubsub1.subscribe(async (message) => {
        messages.push(message);
      });

      const pubsub2 = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "channel2",
      });

      await pubsub2.publish("should not receive");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(messages).toHaveLength(0);
    });
  });

  describe("Type safety", () => {
    test("should work with object types", async () => {
      const redis = createMockRedis();

      const pubsub = new PubSub<{ name: string; age: number }>({
        subscriber: redis,
        publisher: redis,
        channel: "users",
      });

      let received: unknown = null;

      await pubsub.subscribe(async (message) => {
        received = message;
      });

      await pubsub.publish({ name: "Alice", age: 30 });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(received).toEqual({ name: "Alice", age: 30 });
    });

    test("should work with arrays", async () => {
      const redis = createMockRedis();

      const pubsub = new PubSub<number[]>({
        subscriber: redis,
        publisher: redis,
        channel: "numbers",
      });

      let received: unknown = null;

      await pubsub.subscribe(async (message) => {
        received = message;
      });

      await pubsub.publish([1, 2, 3]);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(received).toEqual([1, 2, 3]);
    });

    test("should work with primitives", async () => {
      const redis = createMockRedis();

      const stringPubSub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "strings",
      });
      const numberPubSub = new PubSub<number>({
        subscriber: redis,
        publisher: redis,
        channel: "numbers",
      });
      const boolPubSub = new PubSub<boolean>({
        subscriber: redis,
        publisher: redis,
        channel: "bools",
      });

      let str = "";
      let num = 0;
      let bool = false;

      await stringPubSub.subscribe(async (message) => {
        str = message;
      });

      await numberPubSub.subscribe(async (message) => {
        num = message;
      });

      await boolPubSub.subscribe(async (message) => {
        bool = message;
      });

      await stringPubSub.publish("hello");
      await numberPubSub.publish(42);
      await boolPubSub.publish(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(str).toBe("hello");
      expect(num).toBe(42);
      expect(bool).toBe(true);
    });

    test("should work with nested objects", async () => {
      const redis = createMockRedis();

      const pubsub = new PubSub<{
        user: { name: string; profile: { age: number } };
      }>({ subscriber: redis, publisher: redis, channel: "complex" });

      let received: unknown = null;

      await pubsub.subscribe(async (message) => {
        received = message;
      });

      await pubsub.publish({
        user: { name: "Bob", profile: { age: 25 } },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(received).toEqual({
        user: { name: "Bob", profile: { age: 25 } },
      });
    });
  });

  describe("Error handling", () => {
    test("should handle serialization errors", async () => {
      const redis = createMockRedis();

      type CircularType = { a: number; self?: CircularType };

      const pubsub = new PubSub<CircularType>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      const circular: CircularType = { a: 1 };

      circular.self = circular;

      const [error, data] = await pubsub.publish(circular);

      expect(error).toEqual({
        type: "SerializationError",
        message: "Unable to serialize message",
      });

      expect(data).toBeNull();
    });

    test("should handle publish errors", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      redis.setShouldFail(true);

      const [error, data] = await pubsub.publish("message");

      expect(error).toEqual({
        type: "PublishError",
        message: "Unable to publish to test",
      });

      expect(data).toBeNull();
    });

    test("should handle subscribe errors", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      redis.setShouldFail(true);

      const [error, data] = await pubsub.subscribe(async () => {});

      expect(error).toEqual({
        type: "SubscribeError",
        message: "Unable to subscribe to test",
      });

      expect(data).toBeNull();
      expect(pubsub.isActive()).toBe(false);
    });

    test("should handle unsubscribe errors", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      await pubsub.subscribe(async () => {});

      redis.setShouldFail(true);

      const [error, data] = await pubsub.unsubscribe();

      expect(error).toEqual({
        type: "UnsubscribeError",
        message: "Unable to unsubscribe from test",
      });

      expect(data).toBeNull();
    });

    test("should handle invalid JSON gracefully", async () => {
      const redis = createMockRedis();

      const pubsub = new PubSub<{ name: string }>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      const messages: { name: string }[] = [];

      await pubsub.subscribe(async (message) => {
        messages.push(message);
      });

      // Simulate receiving invalid JSON
      const handler = redis.getSubscriptions().get("test");

      if (handler) {
        await handler("not valid json {", "test");
      }

      // Should not receive any messages due to parse error
      expect(messages).toHaveLength(0);

      // Subscription should still be active
      expect(pubsub.isActive()).toBe(true);
    });

    test("should handle handler errors gracefully", async () => {
      const redis = createMockRedis();

      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      let errorThrown = false;

      await pubsub.subscribe(async () => {
        errorThrown = true;
        throw new Error("Handler error");
      });

      await pubsub.publish("test");

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Handler was called and threw error
      expect(errorThrown).toBe(true);

      // Subscription should still be active despite handler error
      expect(pubsub.isActive()).toBe(true);
    });

    test("should handle synchronous handler errors gracefully", async () => {
      const redis = createMockRedis();

      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      let errorThrown = false;

      await pubsub.subscribe(() => {
        errorThrown = true;
        throw new Error("Synchronous handler error");
      });

      await pubsub.publish("test");

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Handler was called and threw error
      expect(errorThrown).toBe(true);

      // Subscription should still be active despite handler error
      expect(pubsub.isActive()).toBe(true);
    });
  });

  describe("Multiple instances", () => {
    test("should support multiple PubSub instances on different channels", async () => {
      const redis = createMockRedis();

      const pubsub1 = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "channel1",
      });
      const pubsub2 = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "channel2",
      });

      const messages1: string[] = [];
      const messages2: string[] = [];

      await pubsub1.subscribe(async (message) => {
        messages1.push(message);
      });

      await pubsub2.subscribe(async (message) => {
        messages2.push(message);
      });

      await pubsub1.publish("message1");
      await pubsub2.publish("message2");

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(messages1).toEqual(["message1"]);
      expect(messages2).toEqual(["message2"]);
    });

    test("should allow one instance to publish and another to receive", async () => {
      const redis = createMockRedis();

      const subscriber = new PubSub<{ event: string }>({
        subscriber: redis,
        publisher: redis,
        channel: "events",
      });

      const publisher = new PubSub<{ event: string }>({
        subscriber: redis,
        publisher: redis,
        channel: "events",
      });

      const messages: { event: string }[] = [];

      await subscriber.subscribe(async (message) => {
        messages.push(message);
      });

      await publisher.publish({ event: "test" });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ event: "test" });
    });
  });

  describe("Lifecycle", () => {
    test("should track subscription state correctly", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      expect(pubsub.isActive()).toBe(false);

      await pubsub.subscribe(async () => {});

      expect(pubsub.isActive()).toBe(true);

      await pubsub.unsubscribe();

      expect(pubsub.isActive()).toBe(false);
    });

    test("should clean up handler on unsubscribe", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      let callCount = 0;

      await pubsub.subscribe(async () => {
        callCount++;
      });

      await pubsub.publish("message1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callCount).toBe(1);

      await pubsub.unsubscribe();

      // Subscribe new handler
      await pubsub.subscribe(async () => {
        callCount += 10;
      });

      await pubsub.publish("message2");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(callCount).toBe(11); // Old handler not called, new one adds 10
    });

    test("should prevent concurrent unsubscribe calls", async () => {
      const redis = createMockRedis();
      const pubsub = new PubSub<string>({
        subscriber: redis,
        publisher: redis,
        channel: "test",
      });

      await pubsub.subscribe(async () => {});

      expect(pubsub.isActive()).toBe(true);

      // Attempt two concurrent unsubscribe calls using Promise.all
      const results = await Promise.all([
        pubsub.unsubscribe(),
        pubsub.unsubscribe(),
      ]);

      const [error1] = results[0];
      const [error2] = results[1];

      // Only one should succeed (null error), the other should fail
      const successCount = [error1, error2].filter((e) => e === null).length;
      const failureCount = [error1, error2].filter((e) => e !== null).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
      expect(pubsub.isActive()).toBe(false);
    });
  });
});
