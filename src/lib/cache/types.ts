export interface RedisClient {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string): Promise<"OK" | string | null | undefined>;
  set(
    key: string,
    value: string,
    px: "PX",
    ttl: number,
  ): Promise<"OK" | string | null | undefined>;
  del(key: string): Promise<number>;
}

export type CacheOptions<T> = {
  redis: RedisClient;
  ttl?: number | ((key: string, value: T) => number);
  enabled?: boolean;
  prefix?: string;
  serializer?: (value: T) => string;
  deserializer?: (raw: string) => T;
};
