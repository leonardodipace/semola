import { setTimeout as delay } from "node:timers/promises";
import { mightThrow } from "../errors/index.js";
import { createRedisAdapter } from "./adapter.js";
import type { ValkeyGlideClient } from "./types.js";

const SUBSCRIBE_TIMEOUT_MS = 5_000;

const POLL_RETRY_DELAY_MS = 100;

// Valkey GLIDE. Subscribe on a separate client created without a pubsub callback.
export const fromValkeyGlide = (client: ValkeyGlideClient) =>
  createRedisAdapter(client, (dispatch) => {
    let polling = false;
    // Set when the client has its own pubsub callback, so polling cannot work.
    let pollFailure: Error | null = null;

    const poll = async () => {
      while (true) {
        const [error, message] = await mightThrow(client.getPubSubMessage());

        if (!error) {
          dispatch(String(message.channel), String(message.message));
          continue;
        }

        if (error.name === "ClosingError") return;

        if (error.name === "ConfigurationError") {
          pollFailure = error;

          return;
        }

        // Retries every 100ms until the client closes; GLIDE reconnects on its own.
        await delay(POLL_RETRY_DELAY_MS);
      }
    };

    // GLIDE still applies a timed-out call later, so failures are undone.
    // Holds channels whose listeners rely on a confirmed subscribe.
    const subscribed = new Set<string>();

    const subscribe = async (channel: string) => {
      if (!polling) {
        polling = true;
        void poll();
      }

      const [subscribeError] = await mightThrow(
        client.subscribe([channel], SUBSCRIBE_TIMEOUT_MS),
      );
      // The first poll fails before the server confirms the subscribe.
      const error = subscribeError ?? pollFailure;

      if (!error) {
        subscribed.add(channel);

        return;
      }

      if (!subscribed.has(channel)) {
        await mightThrow(client.unsubscribeLazy([channel]));
      }

      throw error;
    };

    const unsubscribe = async (channel: string) => {
      const [error] = await mightThrow(
        client.unsubscribe([channel], SUBSCRIBE_TIMEOUT_MS),
      );

      if (error) {
        await mightThrow(client.subscribeLazy([channel]));

        throw error;
      }

      subscribed.delete(channel);
    };

    return {
      send: (command, args) => client.customCommand([command, ...args]),
      subscribe,
      unsubscribe,
    };
  });
