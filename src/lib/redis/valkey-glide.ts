import { setTimeout as delay } from "node:timers/promises";
import { mightThrow } from "../errors/index.js";
import { createRedisAdapter } from "./adapter.js";
import type {
  RedisClientSpec,
  RedisDispatch,
  ValkeyGlideClient,
  ValkeyGlideRecordEntry,
} from "./types.js";

const SUBSCRIBE_TIMEOUT_MS = 5_000;
export const POLL_RETRY_DELAY_MS = 100;

// Polling failed for good because the client has its own pubsub callback.
const pollFailures = new WeakMap<ValkeyGlideClient, Error>();

// GLIDE returns map replies (HGETALL) as [{ key, value }].
const isGlideRecord = (reply: unknown[]) => {
  const [first] = reply;

  if (typeof first !== "object") return false;
  if (first === null) return false;
  if (!("key" in first)) return false;

  return "value" in first;
};

const fromGlideReply = (reply: unknown) => {
  if (!Array.isArray(reply)) return reply;
  if (!isGlideRecord(reply)) return reply;

  // Only the first entry is checked; GLIDE map entries all share its shape.
  return Object.fromEntries(
    reply.map(({ key, value }: ValkeyGlideRecordEntry) => [String(key), value]),
  );
};

const pollMessages = async (
  client: ValkeyGlideClient,
  dispatch: RedisDispatch,
) => {
  while (true) {
    const [error, message] = await mightThrow(client.getPubSubMessage());

    if (!error) {
      dispatch(String(message.channel), String(message.message));
      continue;
    }

    if (error.name === "ClosingError") return;

    if (error.name === "ConfigurationError") {
      pollFailures.set(client, error);

      return;
    }

    // ponytail: retries every 100ms until the client closes; GLIDE reconnects on its own.
    await delay(POLL_RETRY_DELAY_MS);
  }
};

const subscribeChannel = async (client: ValkeyGlideClient, channel: string) => {
  await client.subscribe([channel], SUBSCRIBE_TIMEOUT_MS);

  // The first poll fails before the server confirms the subscribe.
  const failure = pollFailures.get(client);

  if (!failure) return;

  await client.unsubscribe([channel], SUBSCRIBE_TIMEOUT_MS);

  throw failure;
};

const VALKEY_GLIDE_SPEC: RedisClientSpec<ValkeyGlideClient> = {
  send: async (client, command, args) => {
    const reply = await client.customCommand([command, ...args]);

    return fromGlideReply(reply);
  },
  listen: (client, dispatch) => {
    void pollMessages(client, dispatch);
  },
  subscribe: subscribeChannel,
  unsubscribe: (client, channel) =>
    client.unsubscribe([channel], SUBSCRIBE_TIMEOUT_MS),
};

// Valkey GLIDE. Subscribe on a separate client created without a pubsub callback.
export const fromValkeyGlide = (client: ValkeyGlideClient) =>
  createRedisAdapter(VALKEY_GLIDE_SPEC, client);
