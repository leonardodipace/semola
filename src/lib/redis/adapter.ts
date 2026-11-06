import { createChannelSubscriber } from "./channels.js";
import type { RedisAdapter, RedisClientSpec } from "./types.js";

// Subscriptions belong to the connection, so each client gets one adapter.
const adapters = new WeakMap<object, RedisAdapter>();

export const createRedisAdapter = <TClient extends object>(
  spec: RedisClientSpec<TClient>,
  client: TClient,
) => {
  const existing = adapters.get(client);

  if (existing) return existing;

  let listening = false;

  const { subscriber, dispatch } = createChannelSubscriber({
    subscribe: (channel) => spec.subscribe(client, channel, dispatch),
    unsubscribe: (channel) => spec.unsubscribe(client, channel),
  });

  const adapter: RedisAdapter = {
    send: (command, args) => spec.send(client, command, args),
    subscribe: (channel, listener) => {
      if (!listening) {
        spec.listen?.(client, dispatch);
        listening = true;
      }

      return subscriber.subscribe(channel, listener);
    },
    unsubscribe: subscriber.unsubscribe,
  };

  adapters.set(client, adapter);

  return adapter;
};
