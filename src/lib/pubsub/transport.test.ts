import { describe, expect, test } from "bun:test";
import { createRedisTransport, memoryTransport } from "./transport.js";
import type { RedisClient } from "./types.js";

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

  public async unsubscribe(channel: string, handler?: Handler) {
    if (!handler) {
      this.subscriptions.delete(channel);
      return;
    }

    const handlers = this.subscriptions.get(channel);

    if (!handlers) {
      return;
    }

    const remaining = handlers.filter((entry) => entry !== handler);

    if (remaining.length === 0) {
      this.subscriptions.delete(channel);
      return;
    }

    this.subscriptions.set(channel, remaining);
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

  test("publish snapshots subscribers so mid-delivery subscribe is ignored", async () => {
    const received: string[] = [];
    const firstGate = Promise.withResolvers<void>();

    const first: Handler = async (message) => {
      received.push(`a:${message}`);
      await firstGate.promise;
    };

    const late: Handler = (message) => {
      received.push(`b:${message}`);
    };

    await memoryTransport.subscribe("hub-snapshot-add", first);

    const publishPromise = memoryTransport.publish("hub-snapshot-add", "ping");

    await Promise.resolve();
    await memoryTransport.subscribe("hub-snapshot-add", late);

    firstGate.resolve();

    const count = await publishPromise;

    expect(count).toBe(1);
    expect(received).toEqual(["a:ping"]);

    await memoryTransport.unsubscribe("hub-snapshot-add", first);
    await memoryTransport.unsubscribe("hub-snapshot-add", late);
  });

  test("publish snapshots subscribers so mid-delivery unsubscribe still delivers", async () => {
    const received: string[] = [];
    const firstGate = Promise.withResolvers<void>();

    const first: Handler = async (message) => {
      received.push(`a:${message}`);
      await firstGate.promise;
    };

    const second: Handler = (message) => {
      received.push(`b:${message}`);
    };

    await memoryTransport.subscribe("hub-snapshot-del", first);
    await memoryTransport.subscribe("hub-snapshot-del", second);

    const publishPromise = memoryTransport.publish("hub-snapshot-del", "ping");

    await Promise.resolve();
    await memoryTransport.unsubscribe("hub-snapshot-del", second);

    firstGate.resolve();

    const count = await publishPromise;

    expect(count).toBe(2);
    expect(received).toEqual(["a:ping", "b:ping"]);

    await memoryTransport.unsubscribe("hub-snapshot-del", first);
  });

  test("handler rejection does not stop sibling handlers or fail publish", async () => {
    const received: string[] = [];
    const bad: Handler = async () => {
      throw new Error("boom");
    };
    const good: Handler = (message) => {
      received.push(message);
    };

    await memoryTransport.subscribe("hub-reject", bad);
    await memoryTransport.subscribe("hub-reject", good);

    const count = await memoryTransport.publish("hub-reject", "ping");

    expect(count).toBe(2);
    expect(received).toEqual(["ping"]);

    await memoryTransport.unsubscribe("hub-reject", bad);
    await memoryTransport.unsubscribe("hub-reject", good);
  });

  test("publish delivers to handlers concurrently", async () => {
    const started: string[] = [];
    const firstGate = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();

    const first: Handler = async (message) => {
      started.push(`a:${message}`);
      await firstGate.promise;
    };

    const second: Handler = async (message) => {
      started.push(`b:${message}`);
      secondStarted.resolve();
    };

    await memoryTransport.subscribe("hub-concurrent", first);
    await memoryTransport.subscribe("hub-concurrent", second);

    const publishPromise = memoryTransport.publish("hub-concurrent", "ping");

    await secondStarted.promise;

    expect(started).toEqual(["a:ping", "b:ping"]);

    firstGate.resolve();

    const count = await publishPromise;

    expect(count).toBe(2);

    await memoryTransport.unsubscribe("hub-concurrent", first);
    await memoryTransport.unsubscribe("hub-concurrent", second);
  });
});

describe("createRedisTransport unsubscribe", () => {
  test("passes the listener to redis unsubscribe", async () => {
    const calls: Array<{ channel: string; handler?: Handler }> = [];

    const redis = {
      async publish() {
        return 0;
      },
      async subscribe() {
        return 1;
      },
      async unsubscribe(channel: string, handler?: Handler) {
        calls.push({ channel, handler });
      },
    } as unknown as RedisClient;

    const transport = createRedisTransport(redis, redis);
    const handler: Handler = () => {};

    await transport.unsubscribe("redis-listener", handler);

    expect(calls).toEqual([{ channel: "redis-listener", handler }]);
  });
});

describe("createRedisTransport", () => {
  test("forwards publish subscribe unsubscribe to redis clients", async () => {
    const redis = new MockRedisClient() as MockRedisClient & RedisClient;
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
