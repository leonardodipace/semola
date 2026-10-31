import { describe, expect, test } from "bun:test";
import { IoredisRedisAdapter } from "./ioredis.js";
import { resolveRedis } from "./resolve.js";
import type {
  IoredisClient,
  RedisClient,
  RedisSubscribeListener,
} from "./types.js";

class FakeIoredis {
  private messageListeners = new Set<
    (channel: string, message: string) => void
  >();
  public subscribed = new Set<string>();
  public subscribeShouldFail = false;
  public unsubscribeShouldFail = false;

  public async publish(channel: string, message: string) {
    for (const listener of this.messageListeners) {
      listener(channel, message);
    }

    return this.messageListeners.size;
  }

  public async subscribe(...channels: string[]) {
    if (this.subscribeShouldFail) {
      throw new Error("subscribe failed");
    }

    for (const channel of channels) this.subscribed.add(channel);
  }

  public async unsubscribe(...channels: string[]) {
    if (this.unsubscribeShouldFail) {
      throw new Error("unsubscribe failed");
    }

    for (const channel of channels) this.subscribed.delete(channel);
  }

  public on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ) {
    if (event === "message") this.messageListeners.add(listener);
  }

  public off(
    event: "message",
    listener: (channel: string, message: string) => void,
  ) {
    if (event === "message") this.messageListeners.delete(listener);
  }

  public listenerCount() {
    return this.messageListeners.size;
  }
}

describe("resolveRedis", () => {
  test("wraps ioredis for Bun-style subscribe", async () => {
    const raw = new FakeIoredis();
    const redis = resolveRedis(raw as unknown as IoredisClient);
    const seen: string[] = [];
    const handler: RedisSubscribeListener = (message) => {
      seen.push(message);
    };

    expect(redis).toBeInstanceOf(IoredisRedisAdapter);

    await redis.subscribe("ch", handler);
    await raw.publish("ch", "hello");
    await raw.publish("other", "skip");

    expect(seen).toEqual(["hello"]);

    await redis.unsubscribe("ch", handler);
    await raw.publish("ch", "again");

    expect(seen).toEqual(["hello"]);
  });

  test("passes Bun-style clients through", () => {
    const mock = {
      publish: async () => 0,
      subscribe: async (_channel: string, _listener: RedisSubscribeListener) =>
        1,
      unsubscribe: async () => {},
    } satisfies RedisClient;

    expect(resolveRedis(mock)).toBe(mock);
  });

  test("does not double-wrap ioredis adapter", () => {
    const io = new IoredisRedisAdapter(
      new FakeIoredis() as unknown as IoredisClient,
    );

    expect(resolveRedis(io)).toBe(io);
  });
});

describe("IoredisRedisAdapter", () => {
  test("rolls back the bridge when subscribe fails", async () => {
    const raw = new FakeIoredis();
    raw.subscribeShouldFail = true;
    const redis = new IoredisRedisAdapter(raw as unknown as IoredisClient);

    let threw = false;

    try {
      await redis.subscribe("ch", () => {});
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(raw.listenerCount()).toBe(0);
    expect(raw.subscribed.has("ch")).toBe(false);
  });

  test("keeps the bridge when unsubscribe fails", async () => {
    const raw = new FakeIoredis();
    const redis = new IoredisRedisAdapter(raw as unknown as IoredisClient);
    const seen: string[] = [];
    const handler: RedisSubscribeListener = (message) => {
      seen.push(message);
    };

    await redis.subscribe("ch", handler);
    raw.unsubscribeShouldFail = true;

    let threw = false;

    try {
      await redis.unsubscribe("ch", handler);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);

    await raw.publish("ch", "still-there");

    expect(seen).toEqual(["still-there"]);
    expect(raw.subscribed.has("ch")).toBe(true);
  });

  test("keeps a shared channel subscribed for a sibling adapter", async () => {
    const raw = new FakeIoredis();
    const first = new IoredisRedisAdapter(raw as unknown as IoredisClient);
    const second = new IoredisRedisAdapter(raw as unknown as IoredisClient);
    const seen: string[] = [];
    const handlerA: RedisSubscribeListener = () => {};
    const handlerB: RedisSubscribeListener = (message) => {
      seen.push(message);
    };

    await first.subscribe("ch", handlerA);
    await second.subscribe("ch", handlerB);
    await first.unsubscribe("ch", handlerA);

    expect(raw.subscribed.has("ch")).toBe(true);

    await raw.publish("ch", "from-second");

    expect(seen).toEqual(["from-second"]);

    await second.unsubscribe("ch", handlerB);

    expect(raw.subscribed.has("ch")).toBe(false);
  });
});
