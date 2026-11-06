import { describe, expect, test } from "bun:test";
import { fromIoredis } from "./ioredis.js";
import type { RedisDispatch } from "./types.js";

const createFakeIoredis = () => {
  const calls: unknown[][] = [];
  let onMessage: RedisDispatch = () => {};

  const client = {
    call: async (command: string, ...args: string[]) => {
      calls.push([command, ...args]);

      return "OK";
    },
    subscribe: async (...channels: string[]) => {
      calls.push(["SUBSCRIBE", ...channels]);

      return channels.length;
    },
    unsubscribe: async (...channels: string[]) => {
      calls.push(["UNSUBSCRIBE", ...channels]);

      return 0;
    },
    on: (_event: "message", handler: RedisDispatch) => {
      onMessage = handler;
    },
  };

  const emit = (channel: string, message: string) =>
    onMessage(channel, message);

  return { client, calls, emit };
};

describe("fromIoredis", () => {
  test("sends commands through call", async () => {
    const { client, calls } = createFakeIoredis();
    const redis = fromIoredis(client);

    expect(await redis.send("SET", ["k", "v", "PX", "10"])).toBe("OK");
    expect(calls).toEqual([["SET", "k", "v", "PX", "10"]]);
  });

  test("delivers message events to the channel listener", async () => {
    const { client, emit } = createFakeIoredis();
    const redis = fromIoredis(client);
    const received: string[][] = [];

    await redis.subscribe("news", (message, channel) => {
      received.push([message, channel]);
    });

    emit("news", "hello");
    emit("other", "ignored");
    await Bun.sleep(0);

    expect(received).toEqual([["hello", "news"]]);
  });
});
