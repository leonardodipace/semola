import { describe, expect, test } from "bun:test";
import { createRedisAdapter } from "./adapter.js";
import type { RedisDispatch } from "./types.js";

const createFakeClient = () => {
  const calls: string[] = [];
  let failNext: "subscribe" | "unsubscribe" | null = null;
  let dispatch: RedisDispatch = () => {};

  const client = {};

  const redis = createRedisAdapter(client, (onMessage) => {
    dispatch = onMessage;

    return {
      send: async () => "reply",
      subscribe: async (channel) => {
        calls.push(`subscribe:${channel}`);

        if (failNext === "subscribe") {
          failNext = null;
          throw new Error("subscribe failed");
        }
      },
      unsubscribe: async (channel) => {
        calls.push(`unsubscribe:${channel}`);

        if (failNext === "unsubscribe") {
          failNext = null;
          throw new Error("unsubscribe failed");
        }
      },
    };
  });

  const fail = (operation: "subscribe" | "unsubscribe") => {
    failNext = operation;
  };

  const emit = (channel: string, message: string) => dispatch(channel, message);

  return { client, redis, calls, fail, emit };
};

describe("createRedisAdapter", () => {
  test("returns the same adapter for the same client", () => {
    const { client, redis } = createFakeClient();

    const connect = () => {
      throw new Error("not called");
    };

    expect(createRedisAdapter(client, connect)).toBe(redis);
  });

  test("unsubscribes on the server when the last listener leaves", async () => {
    const { redis, calls } = createFakeClient();
    const first = () => {};
    const second = () => {};

    await redis.subscribe("a", first);
    await redis.subscribe("a", second);
    await redis.unsubscribe("a", first);

    expect(calls).toEqual(["subscribe:a", "subscribe:a"]);

    await redis.unsubscribe("a", second);
    await redis.unsubscribe("a", second);

    expect(calls).toEqual(["subscribe:a", "subscribe:a", "unsubscribe:a"]);
  });

  test("keeps delivering when the server unsubscribe fails", async () => {
    const { redis, fail, emit } = createFakeClient();
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    await redis.subscribe("a", listener);

    fail("unsubscribe");

    await expect(redis.unsubscribe("a", listener)).rejects.toThrow(
      "unsubscribe failed",
    );

    emit("a", "still here");
    await Bun.sleep(0);

    expect(received).toEqual(["still here"]);
  });

  test("a subscribe during an in-flight unsubscribe stays subscribed", async () => {
    const { redis, calls, emit } = createFakeClient();
    const received: string[] = [];
    const first = () => {};

    await redis.subscribe("a", first);
    await Promise.all([
      redis.unsubscribe("a", first),
      redis.subscribe("a", (message) => {
        received.push(message);
      }),
    ]);

    emit("a", "after");
    await Bun.sleep(0);

    expect(calls).toEqual(["subscribe:a", "unsubscribe:a", "subscribe:a"]);
    expect(received).toEqual(["after"]);
  });

  test("drops the listener of a failed subscribe", async () => {
    const { redis, fail, emit } = createFakeClient();
    const received: string[] = [];

    fail("subscribe");

    await expect(
      redis.subscribe("a", () => {
        received.push("lost");
      }),
    ).rejects.toThrow("subscribe failed");

    emit("a", "hello");
    await Bun.sleep(0);

    expect(received).toEqual([]);
  });

  test("a failing listener does not stop its siblings or go unhandled", async () => {
    const { redis, emit } = createFakeClient();
    const received: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    await redis.subscribe("a", async () => {
      throw new Error("listener rejected");
    });
    await redis.subscribe("a", (message) => {
      received.push(message);
    });

    emit("a", "hello");
    await Bun.sleep(10);

    process.off("unhandledRejection", onUnhandled);

    expect(received).toEqual(["hello"]);
    expect(unhandled).toEqual([]);
  });
});
