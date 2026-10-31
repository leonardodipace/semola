import { IoredisRedisAdapter } from "./ioredis.js";
import type { IoredisClient, RedisClient, RedisPubSubInput } from "./types.js";

/** Pubsub: Bun / Bun-style as-is; ioredis → {@link IoredisRedisAdapter}. */
export const resolveRedis = (client: RedisPubSubInput): RedisClient => {
  if (client instanceof IoredisRedisAdapter) return client;
  if (client instanceof Bun.RedisClient) return client;

  // Bun-style `subscribe(channel, listener)` has two parameters; ioredis uses rest channels only.
  if (client.subscribe.length >= 2) {
    return client as RedisClient;
  }

  return new IoredisRedisAdapter(client as IoredisClient);
};
