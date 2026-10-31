export type ChannelHandler = (
  message: string,
  channel: string,
) => void | Promise<void>;

export type RedisClient = {
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (
    channel: string,
    listener: ChannelHandler,
  ) => Promise<number | undefined>;
  unsubscribe: (channel: string, listener?: ChannelHandler) => Promise<void>;
};

/** Minimal ioredis-shaped client for {@link fromIoredis}. */
export type IoredisLike = {
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (...channels: string[]) => Promise<unknown>;
  unsubscribe: (...channels: string[]) => Promise<unknown>;
  on: (
    event: "message",
    listener: (channel: string, message: string) => void,
  ) => unknown;
  off: (
    event: "message",
    listener: (channel: string, message: string) => void,
  ) => unknown;
};

export type RedisPubSubOptions = {
  transport?: "redis";
  subscriber: RedisClient;
  publisher: RedisClient;
  channel: string;
};

export type MemoryPubSubOptions = {
  transport: "memory";
  channel: string;
};

export type PubSubOptions = RedisPubSubOptions | MemoryPubSubOptions;

export type ChannelTransport = {
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (
    channel: string,
    handler: ChannelHandler,
  ) => Promise<number | undefined>;
  unsubscribe: (channel: string, handler: ChannelHandler) => Promise<void>;
};

export type MessageHandler<T> = (
  message: T,
  channel: string,
) => void | Promise<void>;

export type ListenOptions = {
  signal?: AbortSignal;
};
