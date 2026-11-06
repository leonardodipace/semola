import { createChannelSubscriber } from "./channels.js";
import type { RedisAdapter, RedisClientSpec } from "./types.js";

// Subscriptions belong to the connection, so each client gets one adapter.
const adapters = new WeakMap<object, RedisAdapter>();

const buildAdapter = <TClient extends object>(
  spec: RedisClientSpec<TClient>,
  client: TClient,
) => {
  let listening = false;

  const { subscriber, dispatch } = createChannelSubscriber({
    subscribe: (channel) => spec.subscribe(client, channel, dispatch),
    unsubscribe: (channel) => spec.unsubscribe(client, channel),
  });

  const listen = () => {
    if (listening) return;

    listening = true;
    spec.listen?.(client, dispatch);
  };

  const adapter: RedisAdapter = {
    send: (command, args) => spec.send(client, command, args),
    subscribe: (channel, listener) => {
      listen();

      return subscriber.subscribe(channel, listener);
    },
    unsubscribe: subscriber.unsubscribe,
  };

  return adapter;
};

export const createRedisAdapter = <TClient extends object>(
  spec: RedisClientSpec<TClient>,
  client: TClient,
) => {
  const existing = adapters.get(client);

  if (existing) return existing;

  const adapter = buildAdapter(spec, client);

  adapters.set(client, adapter);

  return adapter;
};
