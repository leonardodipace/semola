export type CacheOptions = {
  redis: Bun.RedisClient;
  ttl?: number;
  enabled?: boolean;
  prefix?: string;
};
