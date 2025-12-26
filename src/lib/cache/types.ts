export type CacheOptions = {
  redis: Bun.RedisClient;
  ttl?: number;
};
