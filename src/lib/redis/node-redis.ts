import { createRedisAdapter } from "./adapter.js";
import type { NodeRedisClient, RedisClientSpec } from "./types.js";

const NODE_REDIS_SPEC: RedisClientSpec<NodeRedisClient> = {
  send: (client, command, args) => client.sendCommand([command, ...args]),
  subscribe: (client, channel, dispatch) =>
    client.subscribe(channel, (message) => dispatch(channel, message)),
  unsubscribe: (client, channel) => client.unsubscribe(channel),
};

// node-redis. Subscribe on a `client.duplicate()` connection.
export const fromNodeRedis = (client: NodeRedisClient) =>
  createRedisAdapter(NODE_REDIS_SPEC, client);
