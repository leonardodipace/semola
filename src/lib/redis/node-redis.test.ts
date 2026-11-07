import { describe, expect, test } from "bun:test";
import { fromNodeRedis } from "./node-redis.js";
import type { RedisListener } from "./types.js";

const createFakeNodeRedis = () => {
  const calls: unknown[][] = [];

  const client = {
    sendCommand: async (args: string[]) => {
      calls.push(args);

      return "OK";
    },
    subscribe: async (channel: string, listener: RedisListener) => {
      calls.push(["SUBSCRIBE", channel, listener]);
    },
    unsubscribe: async (channel: string, listener: RedisListener) => {
      calls.push(["UNSUBSCRIBE", channel, listener]);
    },
  };

  return { client, calls };
};

describe("fromNodeRedis", () => {
  test("sends commands through sendCommand", async () => {
    const { client, calls } = createFakeNodeRedis();
    const redis = fromNodeRedis(client);

    expect(await redis.send("GET", ["k"])).toBe("OK");
    expect(calls).toEqual([["GET", "k"]]);
  });

  test("passes listeners straight to the client", async () => {
    const { client, calls } = createFakeNodeRedis();
    const redis = fromNodeRedis(client);
    const listener = () => {};

    await redis.subscribe("a", listener);
    await redis.unsubscribe("a", listener);

    expect(calls).toEqual([
      ["SUBSCRIBE", "a", listener],
      ["UNSUBSCRIBE", "a", listener],
    ]);
  });
});
