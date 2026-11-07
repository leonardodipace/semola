import { mightThrow } from "../errors/index.js";
import type {
  RedisAdapter,
  RedisConnection,
  RedisDispatch,
  RedisListener,
} from "./types.js";

// Subscriptions belong to the connection, so each client gets one adapter.
const adapters = new WeakMap<object, RedisAdapter>();

export const createRedisAdapter = <TClient extends object>(
  client: TClient,
  connect: (dispatch: RedisDispatch) => RedisConnection,
) => {
  const existing = adapters.get(client);

  if (existing) return existing;

  const channels = new Map<string, Set<RedisListener>>();

  const dispatch: RedisDispatch = (channel, message) => {
    for (const listener of channels.get(channel) ?? []) {
      // Listener errors are dropped so one listener cannot break the others.
      void mightThrow(Promise.resolve().then(() => listener(message, channel)));
    }
  };

  const connection = connect(dispatch);

  // No lock: a connection runs commands in order and SUBSCRIBE is
  // idempotent, so subscribing on every call keeps the server in sync.
  const subscribe = async (channel: string, listener: RedisListener) => {
    const listeners = channels.get(channel) ?? new Set();
    const wasRegistered = listeners.has(listener);

    listeners.add(listener);
    channels.set(channel, listeners);

    const [error] = await mightThrow(connection.subscribe(channel));

    if (!error) return;

    // A listener from an earlier successful subscribe stays registered.
    if (wasRegistered) throw error;

    listeners.delete(listener);

    if (listeners.size === 0) channels.delete(channel);

    throw error;
  };

  const unsubscribe = async (channel: string, listener: RedisListener) => {
    const listeners = channels.get(channel);

    if (!listeners) return;
    if (!listeners.has(listener)) return;

    // The last listener leaves only after the server confirms, so a failed unsubscribe keeps delivering.
    if (listeners.size === 1) await connection.unsubscribe(channel);

    listeners.delete(listener);

    if (listeners.size === 0) channels.delete(channel);
  };

  const adapter: RedisAdapter = {
    send: connection.send,
    subscribe,
    unsubscribe,
  };

  adapters.set(client, adapter);

  return adapter;
};
