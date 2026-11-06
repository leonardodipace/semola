import { createRedisAdapter } from "./adapter.js";
import type { IoredisClient, RedisClientSpec } from "./types.js";

const IOREDIS_SPEC: RedisClientSpec<IoredisClient> = {
  send: (client, command, args) => client.call(command, ...args),
  listen: (client, dispatch) => {
    client.on("message", dispatch);
  },
  subscribe: (client, channel) => client.subscribe(channel),
  unsubscribe: (client, channel) => client.unsubscribe(channel),
};

// ioredis and iovalkey. Subscribe on a separate connection.
export const fromIoredis = (client: IoredisClient) =>
  createRedisAdapter(IOREDIS_SPEC, client);
