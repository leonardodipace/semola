import { describe, expect, test } from "bun:test";
import { createRedisTransport, memoryTransport } from "./transport.js";

type Handler = (message: string, channel: string) => void | Promise<void>;

class MockRedisClient {
  private subscriptions = new Map<string, Handler[]>();

  public async publish(channel: string, message: string) {
    const channelHandlers = this.subscriptions.get(channel) ?? [];
    let count = 0;

    for (const handler of channelHandlers) {
      await handler(message, channel);
      count += 1;
    }

    return count;
  }

  public async subscribe(channel: string, handler: Handler) {
    const handlers = this.subscriptions.get(channel) ?? [];

    handlers.push(handler);
    this.subscriptions.set(channel, handlers);

    return handlers.length;
  }

  public async unsubscribe(channel: string) {
    this.subscriptions.delete(channel);
  }
}

describe("memoryTransport", () => {
  test("delivers to every subscriber on the channel", async () => {
    const received: string[] = [];
    const first: Handler = (message) => {
      received.push(`a:${message}`);
    };
    const second: Handler = (message) => {
      received.push(`b:${message}`);
    };

    await memoryTransport.subscribe("hub-fanout", first);
    await memoryTransport.subscribe("hub-fanout", second);

    const count = await memoryTransport.publish("hub-fanout", "ping");

    expect(count).toBe(2);
    expect(received).toEqual(["a:ping", "b:ping"]);

    await memoryTransport.unsubscribe("hub-fanout", first);
    await memoryTransport.unsubscribe("hub-fanout", second);
  });

  test("unsubscribe removes only that handler", async () => {
    const received: string[] = [];
    const first: Handler = (message) => {
      received.push(`a:${message}`);
    };
    const second: Handler = (message) => {
      received.push(`b:${message}`);
    };

    await memoryTransport.subscribe("hub-partial", first);
    await memoryTransport.subscribe("hub-partial", second);
    await memoryTransport.unsubscribe("hub-partial", first);

    const count = await memoryTransport.publish("hub-partial", "ping");

    expect(count).toBe(1);
    expect(received).toEqual(["b:ping"]);

    await memoryTransport.unsubscribe("hub-partial", second);
  });

  test("publish to empty channel returns zero", async () => {
    const count = await memoryTransport.publish("hub-empty", "ping");

    expect(count).toBe(0);
  });
});

describe("createRedisTransport", () => {
  test("forwards publish subscribe unsubscribe to redis clients", async () => {
    const redis = new MockRedisClient() as MockRedisClient & Bun.RedisClient;
    const transport = createRedisTransport(redis, redis);
    const received: string[] = [];

    const handler: Handler = (message) => {
      received.push(message);
    };

    const subscribeCount = await transport.subscribe("redis-fwd", handler);

    expect(subscribeCount).toBe(1);

    const publishCount = await transport.publish("redis-fwd", "hello");

    expect(publishCount).toBe(1);
    expect(received).toEqual(["hello"]);

    await transport.unsubscribe("redis-fwd", handler);

    const after = await transport.publish("redis-fwd", "gone");

    expect(after).toBe(0);
  });
});
