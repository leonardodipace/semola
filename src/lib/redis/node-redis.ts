import { createRedisAdapter } from "./adapter.js";
import type { NodeRedisClient, RedisListener } from "./types.js";

// node-redis. Subscribe on a `client.duplicate()` connection.
export const fromNodeRedis = (client: NodeRedisClient) =>
  createRedisAdapter(client, (dispatch) => {
    // node-redis stops at a throwing listener, so the adapter fans out instead.
    const onMessage: RedisListener = (message, channel) => {
      dispatch(channel, message);
    };

    return {
      send: (command, args) => client.sendCommand([command, ...args]),
      subscribe: (channel) => client.subscribe(channel, onMessage),
      unsubscribe: (channel) => client.unsubscribe(channel, onMessage),
    };
  });
