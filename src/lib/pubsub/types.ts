export type RedisPubSubOptions = {
  transport?: "redis";
  subscriber: Bun.RedisClient;
  publisher: Bun.RedisClient;
  channel: string;
};

export type MemoryPubSubOptions = {
  transport: "memory";
  channel: string;
};

export type PubSubOptions = RedisPubSubOptions | MemoryPubSubOptions;

export type ChannelHandler = (
  message: string,
  channel: string,
) => void | Promise<void>;

export type ChannelTransport = {
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (channel: string, handler: ChannelHandler) => Promise<number>;
  unsubscribe: (channel: string, handler: ChannelHandler) => Promise<void>;
};

export type MessageHandler<T> = (
  message: T,
  channel: string,
) => void | Promise<void>;

export type ListenOptions = {
  signal?: AbortSignal;
};
