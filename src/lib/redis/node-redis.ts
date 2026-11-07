import type { NodeRedisClient, RedisAdapter } from "./types.js";

// node-redis. Subscribe on a `client.duplicate()` connection; it shares a
// channel between listeners on its own.
export const fromNodeRedis = (client: NodeRedisClient) => {
  const adapter: RedisAdapter = {
    send: (command, args) => client.sendCommand([command, ...args]),
    subscribe: (channel, listener) => client.subscribe(channel, listener),
    unsubscribe: (channel, listener) => client.unsubscribe(channel, listener),
  };

  return adapter;
};
