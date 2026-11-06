import { describe, expect, test } from "bun:test";
import { fromNodeRedis } from "./node-redis.js";
import type { RedisListener } from "./types.js";

const createFakeNodeRedis = () => {
  const commands: string[][] = [];
  const listeners = new Map<string, RedisListener>();

  const client = {
    sendCommand: async (args: string[]) => {
      commands.push(args);

      return "OK";
    },
    subscribe: async (channel: string, listener: RedisListener) => {
      commands.push(["SUBSCRIBE", channel]);
      listeners.set(channel, listener);
    },
    unsubscribe: async (channel: string) => {
      commands.push(["UNSUBSCRIBE", channel]);
      listeners.delete(channel);
    },
  };

  const publish = (channel: string, message: string) =>
    listeners.get(channel)?.(message, channel);

  return { client, commands, publish };
};

describe("fromNodeRedis", () => {
  test("sends commands through sendCommand", async () => {
    const { client, commands } = createFakeNodeRedis();
    const redis = fromNodeRedis(client);

    expect(await redis.send("GET", ["k"])).toBe("OK");
    expect(commands).toEqual([["GET", "k"]]);
  });

  test("delivers messages to every listener on the channel", async () => {
    const { client, commands, publish } = createFakeNodeRedis();
    const redis = fromNodeRedis(client);
    const received: string[] = [];
    const first = (message: string) => {
      received.push(`first:${message}`);
    };
    const second = (message: string) => {
      received.push(`second:${message}`);
    };

    await redis.subscribe("a", first);
    await redis.subscribe("a", second);

    publish("a", "hello");
    await Bun.sleep(0);

    await redis.unsubscribe("a", first);
    await redis.unsubscribe("a", second);

    expect(received).toEqual(["first:hello", "second:hello"]);
    expect(commands).toEqual([
      ["SUBSCRIBE", "a"],
      ["UNSUBSCRIBE", "a"],
    ]);
  });
});
