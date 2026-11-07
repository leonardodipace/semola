import { describe, expect, test } from "bun:test";
import type { GlideClient } from "@valkey/valkey-glide";
import type { ValkeyGlideMessage } from "./types.js";
import { fromValkeyGlide, POLL_RETRY_DELAY_MS } from "./valkey-glide.js";

// Type check only: a real GLIDE client must fit the adapter.
export const adaptRealGlide = (client: GlideClient) => fromValkeyGlide(client);

const namedError = (name: string) => {
  const error = new Error(name);

  error.name = name;

  return error;
};

const createFakeGlide = () => {
  const commands: string[][] = [];
  const subscriptions: string[][] = [];
  const queue: ValkeyGlideMessage[] = [];
  const failures: Error[] = [];
  const pollWaiters: (() => void)[] = [];
  let polls = 0;
  let waiting: ((message: ValkeyGlideMessage) => void) | null = null;

  const client = {
    customCommand: async (args: string[]) => {
      commands.push(args);

      return "OK";
    },
    subscribe: async (channels: Iterable<string>) => {
      // A real subscribe waits on the server, so pending microtasks run first.
      await Bun.sleep(0);
      subscriptions.push(["subscribe", ...channels]);
    },
    unsubscribe: async (channels: Iterable<string>) => {
      subscriptions.push(["unsubscribe", ...channels]);
    },
    getPubSubMessage: () => {
      polls += 1;

      for (const resolve of pollWaiters.splice(0)) resolve();

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

  const nextPoll = () => {
    const { promise, resolve } = Promise.withResolvers<void>();

    pollWaiters.push(resolve);

    return promise;
  };

  return {
    client,
    commands,
    subscriptions,
    publish,
    failNextPoll,
    pollCount,
    nextPoll,
  };
};

describe("fromValkeyGlide", () => {
  test("sends commands through customCommand", async () => {
    const { client, commands } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    expect(await redis.send("GET", ["k"])).toBe("OK");
    expect(commands).toEqual([["GET", "k"]]);
  });

  test("does not poll until something subscribes", async () => {
    const { client, pollCount } = createFakeGlide();

    await fromValkeyGlide(client).send("PING", []);

    expect(pollCount()).toBe(0);
  });

  test("pulls messages and delivers them to the channel listener", async () => {
    const { client, subscriptions, publish } = createFakeGlide();
    const redis = fromValkeyGlide(client);
    const received: string[][] = [];
    const listener = (message: string, channel: string) => {
      received.push([message, channel]);
    };

    await redis.subscribe("news", listener);

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

  test("stops polling for good once the client closes", async () => {
    const { client, failNextPoll, pollCount } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    failNextPoll(namedError("ClosingError"));
    await redis.subscribe("a", () => {});
    await Bun.sleep(POLL_RETRY_DELAY_MS * 2);

    expect(pollCount()).toBe(1);
  });

  test("rejects subscribe when the client has its own pubsub callback", async () => {
    const { client, failNextPoll, pollCount, subscriptions } =
      createFakeGlide();
    const redis = fromValkeyGlide(client);
    const failure = namedError("ConfigurationError");

    failNextPoll(failure);

    await expect(redis.subscribe("a", () => {})).rejects.toBe(failure);
    await expect(redis.subscribe("b", () => {})).rejects.toBe(failure);
    await Bun.sleep(POLL_RETRY_DELAY_MS * 2);

    expect(pollCount()).toBe(1);
    expect(subscriptions).toEqual([
      ["subscribe", "a"],
      ["unsubscribe", "a"],
      ["subscribe", "b"],
      ["unsubscribe", "b"],
    ]);
  });

  test("waits before retrying after a connection error", async () => {
    const { client, failNextPoll, pollCount, nextPoll } = createFakeGlide();
    const redis = fromValkeyGlide(client);

    failNextPoll(namedError("ConnectionError"));
    await redis.subscribe("a", () => {});

    const retried = nextPoll();

    await Bun.sleep(0);

    expect(pollCount()).toBe(1);

    await retried;

    expect(pollCount()).toBe(2);
  });
});
