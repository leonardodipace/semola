import type { RedisPubSubInput } from "../redis/types.js";

export type ChannelHandler = (
  message: string,
  channel: string,
) => void | Promise<void>;

export type RedisPubSubOptions = {
  transport?: "redis";
  subscriber: RedisPubSubInput;
  publisher: RedisPubSubInput;
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
