import { createRedisAdapter } from "./adapter.js";
import type { IoredisClient } from "./types.js";

// ioredis and iovalkey. Subscribe on a separate connection.
export const fromIoredis = (client: IoredisClient) =>
  createRedisAdapter(client, (dispatch) => {
    client.on("message", dispatch);

    return {
      send: (command, args) => client.call(command, ...args),
      subscribe: (channel) => client.subscribe(channel),
      unsubscribe: (channel) => client.unsubscribe(channel),
    };
  });
