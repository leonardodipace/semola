// Any Redis client that can send a raw command (Bun.RedisClient works as-is).
export type RedisClient = {
  send(command: string, args: string[]): Promise<unknown>;
};

// Bun-style subscribe: the listener is passed per channel.
export type RedisSubscriber = {
  subscribe(channel: string, listener: ChannelHandler): Promise<number>;
  unsubscribe(channel: string, listener: ChannelHandler): Promise<unknown>;
};

export type RedisPubSubOptions = {
  transport?: "redis";
  subscriber: RedisSubscriber;
  publisher: RedisClient;
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
