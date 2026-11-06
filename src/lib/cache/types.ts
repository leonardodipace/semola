// Any Redis client that can send a raw command (Bun.RedisClient works as-is).
export type RedisClient = {
  send(command: string, args: string[]): Promise<unknown>;
};

export type CacheOptions<T> = {
  redis: RedisClient;
  ttl?: number | ((key: string, value: T) => number);
  enabled?: boolean;
  prefix?: string;
  serializer?: (value: T) => string;
  deserializer?: (raw: string) => T;
};
