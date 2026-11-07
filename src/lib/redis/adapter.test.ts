import { afterAll, describe, expect, test } from "bun:test";
import { once } from "node:events";
import type { Redis } from "ioredis";
import {
  closeClients,
  createIoredis,
  publishAndSettle,
  SEMOLA_REDIS_URL,
  uniqueName,
} from "./integration-helpers.js";
import { fromIoredis } from "./ioredis.js";

afterAll(closeClients);

// Commands sent until `reconnect` reject at once, as the offline queue is
// off. On reconnect, ioredis subscribes again to the channels it holds.
const dropConnection = (client: Redis) => {
  const ended = once(client, "end");

  client.disconnect();

  const reconnect = async () => {
    await ended;
    await client.connect();
  };

  return reconnect;
};

const connect = async () => {
  const client = await createIoredis({ enableOfflineQueue: false });

  return { client, subscriber: fromIoredis(client) };
};

describe.skipIf(!SEMOLA_REDIS_URL)("createRedisAdapter", () => {
  test("returns the same adapter for the same client", async () => {
    const { client, subscriber } = await connect();

    expect(fromIoredis(client)).toBe(subscriber);
  });

  test("drops the listener of a failed subscribe", async () => {
    const { client, subscriber } = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const reconnect = dropConnection(client);

    const failed = subscriber.subscribe(channel, () => {
      received.push("lost");
    });

    await expect(failed).rejects.toThrow();
    await reconnect();
    await subscriber.subscribe(channel, () => {
      received.push("other");
    });
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["other"]);
  });

  test("keeps a registered listener when subscribing it again fails", async () => {
    const { client, subscriber } = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    await subscriber.subscribe(channel, listener);

    const reconnect = dropConnection(client);

    await expect(subscriber.subscribe(channel, listener)).rejects.toThrow();
    await reconnect();
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["hello"]);
  });

  test("keeps delivering when the unsubscribe fails", async () => {
    const { client, subscriber } = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    await subscriber.subscribe(channel, listener);

    const reconnect = dropConnection(client);

    await expect(subscriber.unsubscribe(channel, listener)).rejects.toThrow();
    await reconnect();
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["hello"]);
  });

  test("a dropped connection does not keep a listener that left", async () => {
    const { client, subscriber } = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const leaving = () => {
      received.push("leaving");
    };
    const reconnect = dropConnection(client);

    await Promise.allSettled([
      subscriber.subscribe(channel, leaving),
      subscriber.unsubscribe(channel, leaving),
    ]);
    await reconnect();
    await subscriber.subscribe(channel, () => {
      received.push("other");
    });
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["other"]);
  });

  test("a dropped connection keeps a subscribed listener", async () => {
    const { client, subscriber } = await connect();
    const channel = uniqueName();
    const received: string[] = [];
    const listener = (message: string) => {
      received.push(message);
    };

    await subscriber.subscribe(channel, listener);

    const reconnect = dropConnection(client);

    await Promise.allSettled([
      subscriber.unsubscribe(channel, listener),
      subscriber.subscribe(channel, listener),
    ]);
    await reconnect();
    await publishAndSettle(subscriber, channel, "hello");

    expect(received).toEqual(["hello"]);
  });
});
