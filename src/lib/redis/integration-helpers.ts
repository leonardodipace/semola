import { expect, test } from "bun:test";
import type { GlideClientConfiguration } from "@valkey/valkey-glide";
import { Redis, type RedisOptions } from "ioredis";
import { createClient } from "redis";
import { fromIoredis } from "./ioredis.js";
import { fromNodeRedis } from "./node-redis.js";
import type { RedisAdapter, RedisSubscriber } from "./types.js";
import { fromValkeyGlide } from "./valkey-glide.js";

export const SEMOLA_REDIS_URL = process.env.SEMOLA_REDIS_URL;

// GLIDE ships no Windows binary.
export const GLIDE_UNAVAILABLE = process.platform === "win32";

export type Connect = () => Promise<RedisAdapter>;

const closers: (() => unknown)[] = [];
let publisher: Bun.RedisClient | null = null;

export const closeClients = () => {
  for (const close of closers.splice(0)) close();

  publisher = null;
};

export const uniqueName = () => `semola:${crypto.randomUUID()}`;

export const createBun = () => {
  const client = new Bun.RedisClient(SEMOLA_REDIS_URL);

  closers.push(() => client.close());

  return client;
};

export const connectBun: Connect = async () => createBun();

// A plain connection for publishing and checking the server's state.
export const server = () => {
  publisher ??= createBun();

  return publisher;
};

export const createIoredis = async (options: RedisOptions = {}) => {
  const client = new Redis(SEMOLA_REDIS_URL ?? "", {
    ...options,
    lazyConnect: true,
  });

  closers.push(() => client.disconnect());
  await client.connect();

  return client;
};

export const connectIoredis =
  (options?: RedisOptions): Connect =>
  async () =>
    fromIoredis(await createIoredis(options));

export const connectNodeRedis: Connect = async () => {
  const client = createClient({ url: SEMOLA_REDIS_URL });

  closers.push(() => client.destroy());
  await client.connect();

  return fromNodeRedis(client);
};

export const createValkeyGlide = async (
  config: Partial<GlideClientConfiguration> = {},
) => {
  const { GlideClient } = await import("@valkey/valkey-glide");
  const { hostname, port } = new URL(SEMOLA_REDIS_URL ?? "");
  const client = await GlideClient.createClient({
    ...config,
    addresses: [{ host: hostname, port: Number(port) }],
  });

  closers.push(() => client.close());

  return client;
};

export const connectValkeyGlide: Connect = async () =>
  fromValkeyGlide(await createValkeyGlide());

export const subscriberCount = async (channel: string) => {
  const [, count] = (await server().send("PUBSUB", ["NUMSUB", channel])) as [
    string,
    number,
  ];

  return count;
};

// One connection delivers in order, so once a later message on another
// channel arrives, every listener of `channel` has run.
export const publishAndSettle = async (
  subscriber: RedisSubscriber,
  channel: string,
  message: string,
) => {
  const witness = uniqueName();
  const arrived = Promise.withResolvers<string>();

  await subscriber.subscribe(witness, arrived.resolve);
  await server().send("PUBLISH", [channel, message]);
  await server().send("PUBLISH", [witness, "done"]);
  await arrived.promise;
  await subscriber.unsubscribe(witness, arrived.resolve);
};

// The same behavior on every adapter's real subscriber connection.
export const subscriberTests = (connect: Connect) => {
  test("sends commands", async () => {
    const redis = await connect();
    const key = uniqueName();

    await redis.send("SET", [key, "v", "PX", "10000"]);

    expect(await redis.send("GET", [key])).toBe("v");
  });

  test("delivers a message only to its channel's listeners", async () => {
    const subscriber = await connect();
    const channel = uniqueName();
    const received: string[][] = [];

    await subscriber.subscribe(channel, (message, from) => {
      received.push([message, from]);
    });
    await subscriber.subscribe(uniqueName(), () => {
      received.push(["wrong channel"]);
    });
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual([["hello", channel]]);
  });

  test("unsubscribe removes only that listener", async () => {
    const subscriber = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const leaving = () => {
      received.push("leaving");
    };
    const staying = () => {
      received.push("staying");
    };

    await subscriber.subscribe(channel, leaving);
    await subscriber.subscribe(channel, staying);
    await subscriber.unsubscribe(channel, leaving);
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["staying"]);
    expect(await subscriberCount(channel)).toBe(1);

    await subscriber.unsubscribe(channel, staying);

    expect(await subscriberCount(channel)).toBe(0);
  });

  test("a failing listener does not stop the others or go unhandled", async () => {
    const subscriber = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    await subscriber.subscribe(channel, () => {
      throw new Error("listener threw");
    });
    await subscriber.subscribe(channel, async () => {
      throw new Error("listener rejected");
    });
    await subscriber.subscribe(channel, (message) => {
      received.push(message);
    });
    await publishAndSettle(subscriber, channel, "hello");
    await Bun.sleep(10);

    process.off("unhandledRejection", onUnhandled);

    expect(received).toEqual(["hello"]);
    expect(unhandled).toEqual([]);
  });

  test("a listener subscribed while it unsubscribes keeps receiving", async () => {
    const subscriber = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    await subscriber.subscribe(channel, listener);
    await Promise.all([
      subscriber.unsubscribe(channel, listener),
      subscriber.subscribe(channel, listener),
    ]);
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["hello"]);
  });

  test("a listener subscribed while the last one leaves keeps receiving", async () => {
    const subscriber = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const leaving = () => {};

    await subscriber.subscribe(channel, leaving);
    await Promise.all([
      subscriber.unsubscribe(channel, leaving),
      subscriber.subscribe(channel, (message) => {
        received.push(message);
      }),
    ]);
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["hello"]);
  });

  test("a listener subscribed after overlapping unsubscribes keeps receiving", async () => {
    const subscriber = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const leaving = () => {};

    await Promise.all([
      subscriber.subscribe(channel, leaving),
      subscriber.unsubscribe(channel, leaving),
      subscriber.unsubscribe(channel, leaving),
      subscriber.subscribe(channel, (message) => {
        received.push(message);
      }),
    ]);
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["hello"]);
  });
};
