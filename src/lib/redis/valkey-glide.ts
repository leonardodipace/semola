import { setTimeout as delay } from "node:timers/promises";
import { mightThrow } from "../errors/index.js";
import { createRedisAdapter } from "./adapter.js";
import type { ValkeyGlideClient } from "./types.js";

const SUBSCRIBE_TIMEOUT_MS = 5_000;
export const POLL_RETRY_DELAY_MS = 100;

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

        // ponytail: retries every 100ms until the client closes; GLIDE reconnects on its own.
        await delay(POLL_RETRY_DELAY_MS);
      }
    };

    const subscribe = async (channel: string) => {
      if (!polling) {
        polling = true;
        void poll();
      }

      await client.subscribe([channel], SUBSCRIBE_TIMEOUT_MS);

      // The first poll fails before the server confirms the subscribe.
      if (!pollFailure) return;

      await client.unsubscribe([channel], SUBSCRIBE_TIMEOUT_MS);

      throw pollFailure;
    };

    return {
      send: (command, args) => client.customCommand([command, ...args]),
      subscribe,
      unsubscribe: (channel) =>
        client.unsubscribe([channel], SUBSCRIBE_TIMEOUT_MS),
    };
  });
