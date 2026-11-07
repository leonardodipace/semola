import { afterAll, describe, expect, test } from "bun:test";
import type { GlideClient } from "@valkey/valkey-glide";
import {
  closeClients,
  connectValkeyGlide,
  createValkeyGlide,
  GLIDE_UNAVAILABLE,
  publishAndSettle,
  SEMOLA_REDIS_URL,
  server,
  subscriberTests,
  uniqueName,
} from "./integration-helpers.js";
import { fromValkeyGlide } from "./valkey-glide.js";

// Type check only: a real GLIDE client must fit the adapter.
export const adaptRealGlide = (client: GlideClient) => fromValkeyGlide(client);

// Longer than the adapter's 5s subscribe timeout.
const SERVER_PAUSE_MS = 6_000;
const TIMEOUT_TEST_MS = 20_000;

afterAll(closeClients);

const pauseServer = () =>
  server().send("CLIENT", ["PAUSE", String(SERVER_PAUSE_MS), "ALL"]);

const wantsChannel = async (client: GlideClient, channel: string) => {
  const { GlideClientConfiguration } = await import("@valkey/valkey-glide");
  const { desiredSubscriptions } = await client.getSubscriptions();
  const exact = GlideClientConfiguration.PubSubChannelModes.Exact;

  return desiredSubscriptions[exact]?.has(channel) ?? false;
};

describe.skipIf(!SEMOLA_REDIS_URL || GLIDE_UNAVAILABLE)(
  "fromValkeyGlide",
  () => {
    subscriberTests(connectValkeyGlide);

    test("rejects subscribe when the client has its own pubsub callback", async () => {
      const { GlideClientConfiguration } = await import("@valkey/valkey-glide");
      const exact = GlideClientConfiguration.PubSubChannelModes.Exact;
      const client = await createValkeyGlide({
        pubsubSubscriptions: {
          channelsAndPatterns: { [exact]: new Set([uniqueName()]) },
          callback: () => {},
        },
      });

      await expect(
        fromValkeyGlide(client).subscribe(uniqueName(), () => {}),
      ).rejects.toMatchObject({ name: "ConfigurationError" });
    });

    test(
      "undoes a subscribe that times out",
      async () => {
        const client = await createValkeyGlide();
        const subscriber = fromValkeyGlide(client);
        const channel = uniqueName();
        const received: string[] = [];

        await pauseServer();
        await expect(
          subscriber.subscribe(channel, (message) => {
            received.push(message);
          }),
        ).rejects.toThrow();

        expect(await wantsChannel(client, channel)).toBe(false);

        await publishAndSettle(subscriber, channel, "hello");

        expect(received).toEqual([]);
      },
      TIMEOUT_TEST_MS,
    );

    test(
      "keeps a channel other listeners use when a subscribe times out",
      async () => {
        const client = await createValkeyGlide();
        const subscriber = fromValkeyGlide(client);
        const channel = uniqueName();
        const received: string[] = [];

        await subscriber.subscribe(channel, (message) => {
          received.push(message);
        });

        // GLIDE answers a subscribe to a subscribed channel itself, so it only
        // waits on the server while reconnecting, as after this kill.
        const id = String(await client.customCommand(["CLIENT", "ID"]));

        await server().send("MULTI", []);
        await server().send("CLIENT", ["KILL", "ID", id]);
        await pauseServer();
        await server().send("EXEC", []);
        await expect(subscriber.subscribe(channel, () => {})).rejects.toThrow();

        expect(await wantsChannel(client, channel)).toBe(true);

        await publishAndSettle(subscriber, channel, "hello");

        expect(received).toEqual(["hello"]);
      },
      TIMEOUT_TEST_MS,
    );

    test(
      "undoes an unsubscribe that times out",
      async () => {
        const client = await createValkeyGlide();
        const subscriber = fromValkeyGlide(client);
        const channel = uniqueName();
        const received: string[] = [];
        const listener = (message: string) => {
          received.push(message);
        };

        await subscriber.subscribe(channel, listener);
        await pauseServer();
        await expect(
          subscriber.unsubscribe(channel, listener),
        ).rejects.toThrow();

        expect(await wantsChannel(client, channel)).toBe(true);

        // GLIDE subscribes again in the background once the server is back.
        while (received.length === 0) {
          await publishAndSettle(subscriber, channel, "hello");
        }

        expect(received[0]).toBe("hello");
      },
      TIMEOUT_TEST_MS,
    );
  },
);
