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

// Closed client, or messages go to a configured pubsub callback instead.
const STOP_POLLING_ERRORS = new Set(["ClosingError", "ConfigurationError"]);

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

    if (STOP_POLLING_ERRORS.has(error.name)) return;

    // ponytail: retries every 100ms until the client closes; GLIDE reconnects on its own.
    await delay(POLL_RETRY_DELAY_MS);
  }
};

const VALKEY_GLIDE_SPEC: RedisClientSpec<ValkeyGlideClient> = {
  send: async (client, command, args) => {
    const reply = await client.customCommand([command, ...args]);

    return fromGlideReply(reply);
  },
  listen: (client, dispatch) => {
    void pollMessages(client, dispatch);
  },
  subscribe: (client, channel) =>
    client.subscribe([channel], SUBSCRIBE_TIMEOUT_MS),
  unsubscribe: (client, channel) =>
    client.unsubscribe([channel], SUBSCRIBE_TIMEOUT_MS),
};

// Valkey GLIDE. Subscribe on a separate client created without a pubsub callback.
export const fromValkeyGlide = (client: ValkeyGlideClient) =>
  createRedisAdapter(VALKEY_GLIDE_SPEC, client);
