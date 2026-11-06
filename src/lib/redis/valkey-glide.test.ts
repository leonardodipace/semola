import { describe, expect, test } from "bun:test";
import type { GlideClient } from "@valkey/valkey-glide";
import type { ValkeyGlideMessage } from "./types.js";
import { fromValkeyGlide } from "./valkey-glide.js";

// Type check only: a real GLIDE client must fit the adapter.
export const adaptRealGlide = (client: GlideClient) => fromValkeyGlide(client);

const namedError = (name: string) => {
  const error = new Error(name);

  error.name = name;

  return error;
};

const createFakeGlide = (reply: unknown = "OK") => {
  const commands: string[][] = [];
  const subscriptions: string[][] = [];
  const queue: ValkeyGlideMessage[] = [];
  const failures: Error[] = [];
  let polls = 0;
  let waiting: ((message: ValkeyGlideMessage) => void) | null = null;

  const client = {
    customCommand: async (args: string[]) => {
      commands.push(args);

      return reply;
    },
    subscribe: async (channels: Iterable<string>) => {
      subscriptions.push(["subscribe", ...channels]);
    },
    unsubscribe: async (channels: Iterable<string>) => {
      subscriptions.push(["unsubscribe", ...channels]);
    },
    getPubSubMessage: () => {
      polls += 1;

      const failure = failures.shift();

      if (failure) return Promise.reject(failure);

      const next = queue.shift();

      if (next) return Promise.resolve(next);

      return new Promise<ValkeyGlideMessage>((resolve) => {
        waiting = resolve;
      });
    },
  };

  const publish = (channel: unknown, message: unknown) => {
    const resolve = waiting;

    if (!resolve) {
      queue.push({ channel, message });

      return;
    }

    waiting = null;
    resolve({ channel, message });
  };

  const failNextPoll = (error: Error) => {
    failures.push(error);
  };

  const pollCount = () => polls;

  return { client, commands, subscriptions, publish, failNextPoll, pollCount };
};

describe("fromValkeyGlide", () => {
  test("sends commands through customCommand", async () => {
    const { client, commands } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    expect(await redis.send("GET", ["k"])).toBe("OK");
    expect(commands).toEqual([["GET", "k"]]);
  });

  test("turns GLIDE map records into an object", async () => {
    const { client } = createFakeGlide([
      { key: "status", value: "pending" },
      { key: "name", value: "wf" },
    ]);
    const redis = fromValkeyGlide(client);

    expect(await redis.send("HGETALL", ["meta"])).toEqual({
      status: "pending",
      name: "wf",
    });
  });

  test("keeps a map field named __proto__ as data", async () => {
    const { client } = createFakeGlide([{ key: "__proto__", value: "x" }]);
    const reply = await fromValkeyGlide(client).send("HGETALL", ["h"]);

    expect(Object.hasOwn(Object(reply), "__proto__")).toBe(true);
  });

  test.each([
    ["SCAN", ["0", ["a", "b"]]],
    ["objects without a value field", [{ key: "a" }]],
    ["an empty map", []],
  ])("leaves %s replies alone", async (_label, reply) => {
    const { client } = createFakeGlide(reply);
    const redis = fromValkeyGlide(client);

    expect(await redis.send("CMD", [])).toEqual(reply);
  });

  test("pulls messages and delivers them to the channel listener", async () => {
    const { client, subscriptions, publish } = createFakeGlide();
    const redis = fromValkeyGlide(client);
    const received: string[][] = [];
    const listener = (message: string, channel: string) => {
      received.push([message, channel]);
    };

    expect(await redis.subscribe("news", listener)).toBe(1);

    publish("news", "first");
    publish("other", "ignored");
    publish("news", "second");
    await Bun.sleep(0);

    await redis.unsubscribe("news", listener);

    expect(received).toEqual([
      ["first", "news"],
      ["second", "news"],
    ]);
    expect(subscriptions).toEqual([
      ["subscribe", "news"],
      ["unsubscribe", "news"],
    ]);
  });

  test("delivers Buffer channels and messages as strings", async () => {
    const { client, publish } = createFakeGlide();
    const redis = fromValkeyGlide(client);
    const received = Promise.withResolvers<string[]>();

    await redis.subscribe("news", (message, channel) => {
      received.resolve([message, channel]);
    });

    publish(Buffer.from("news"), Buffer.from("hello"));

    expect(await received.promise).toEqual(["hello", "news"]);
  });

  test("keeps one poll in flight across channels", async () => {
    const { client, pollCount } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    await redis.subscribe("a", () => {});
    await redis.subscribe("b", () => {});
    await Bun.sleep(0);

    expect(pollCount()).toBe(1);
  });

  test.each([
    "ClosingError",
    "ConfigurationError",
  ])("stops polling for good on %s", async (name) => {
    const { client, failNextPoll, pollCount } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    failNextPoll(namedError(name));
    await redis.subscribe("a", () => {});
    await Bun.sleep(150);

    expect(pollCount()).toBe(1);
  });

  test("waits before retrying after a connection error", async () => {
    const { client, failNextPoll, pollCount } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    failNextPoll(namedError("ConnectionError"));
    await redis.subscribe("a", () => {});
    await Bun.sleep(0);

    expect(pollCount()).toBe(1);

    await Bun.sleep(150);

    expect(pollCount()).toBe(2);
  });

  test("keeps polling after a temporary connection error", async () => {
    const { client, failNextPoll, publish } = createFakeGlide();
    const redis = fromValkeyGlide(client);
    const received = Promise.withResolvers<string>();

    failNextPoll(namedError("ConnectionError"));
    await redis.subscribe("a", received.resolve);

    publish("a", "after reconnect");

    expect(await received.promise).toBe("after reconnect");
  });
});
