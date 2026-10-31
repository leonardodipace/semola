export type RedisSubscribeListener = (
  message: string,
  channel: string,
) => void | Promise<void>;

/** Commands Semola's Redis-backed modules call (cache, cron, queue, workflow). */
export type RedisCommands = {
  get: (key: string) => Promise<string | null | undefined>;
  set: {
    (key: string, value: string): Promise<"OK" | string | null | undefined>;
    (
      key: string,
      value: string,
      px: "PX",
      ttl: number,
    ): Promise<"OK" | string | null | undefined>;
    (
      key: string,
      value: string,
      px: "PX",
      ttl: number | string,
      nx: "NX",
    ): Promise<"OK" | string | null | undefined>;
  };
  del: (key: string) => Promise<number>;
  eval: (
    script: string,
    numkeys: number,
    ...keysAndArgs: (string | number)[]
  ) => Promise<unknown>;
  lpush: (key: string, ...values: string[]) => Promise<number>;
  lrange: (key: string, start: number, stop: number) => Promise<string[]>;
  hgetall: (key: string) => Promise<Record<string, string> | null | undefined>;
  zcard: (key: string) => Promise<number>;
  zrange: (
    key: string,
    start: string | number,
    stop: string | number,
  ) => Promise<unknown[]>;
  scan: {
    (
      cursor: string | number,
      match: "MATCH",
      pattern: string,
    ): Promise<[string, string[]]>;
    (
      cursor: string | number,
      match: "MATCH",
      pattern: string,
      count: "COUNT",
      hint: number,
    ): Promise<[string, string[]]>;
  };
};

/**
 * Bun-style pub/sub client. Produced by {@link resolveRedis} for pubsub.
 */
export type RedisClient = {
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (
    channel: string,
    listener: RedisSubscribeListener,
  ) => Promise<number | undefined>;
  unsubscribe: (
    channel: string,
    listener?: RedisSubscribeListener,
  ) => Promise<void>;
};

/** Structural ioredis (event subscribe + shared commands). */
export type IoredisClient = RedisCommands & {
  publish: (channel: string, message: string) => Promise<number>;
  on: (
    event: "message",
    listener: (channel: string, message: string) => void,
  ) => unknown;
  off: (
    event: "message",
    listener: (channel: string, message: string) => void,
  ) => unknown;
  subscribe: (...channels: string[]) => Promise<unknown>;
  unsubscribe: (...channels: string[]) => Promise<unknown>;
};

/** Pass Bun Redis or ioredis into cache / cron / queue / workflow. */
export type RedisInput = Bun.RedisClient | IoredisClient | RedisCommands;

/** Pass Bun Redis or ioredis into pubsub (adapter applied internally). */
export type RedisPubSubInput = Bun.RedisClient | IoredisClient | RedisClient;
