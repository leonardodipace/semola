import { IoredisRedisAdapter } from "./ioredis.js";
import type { IoredisClient, RedisClient, RedisPubSubInput } from "./types.js";

const isIoredisClient = (client: RedisPubSubInput): client is IoredisClient => {
  if ("send" in client && typeof client.send === "function") return false;
  if (!("on" in client)) return false;
  if (typeof client.on !== "function") return false;

  return true;
};

/** Pubsub: Bun as-is; ioredis → {@link IoredisRedisAdapter}. */
export const resolveRedis = (client: RedisPubSubInput): RedisClient => {
  if (client instanceof IoredisRedisAdapter) return client;

  if (isIoredisClient(client)) {
    return new IoredisRedisAdapter(client);
  }

  return client as RedisClient;
};
