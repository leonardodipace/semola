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

  public async publish(channel: string, message: string) {
    for (const listener of this.messageListeners) {
      listener(channel, message);
    }

    return this.messageListeners.size;
  }

  public async subscribe() {}
  public async unsubscribe() {}

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

  test("passes Bun and Bun-style clients through", () => {
    const bun = { send: async () => null } as unknown as Bun.RedisClient;
    const mock = {
      publish: async () => 0,
      subscribe: async () => 1,
      unsubscribe: async () => {},
    } satisfies RedisClient;

    expect(resolveRedis(bun)).toBe(bun);
    expect(resolveRedis(mock)).toBe(mock);
  });

  test("does not double-wrap ioredis adapter", () => {
    const io = new IoredisRedisAdapter(
      new FakeIoredis() as unknown as IoredisClient,
    );

    expect(resolveRedis(io)).toBe(io);
  });
});
