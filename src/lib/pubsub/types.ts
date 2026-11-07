import type { RedisClient, RedisSubscriber } from "../redis/types.js";

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
  subscribe: (channel: string, handler: ChannelHandler) => Promise<unknown>;
  unsubscribe: (channel: string, handler: ChannelHandler) => Promise<unknown>;
};

export type MessageHandler<T> = (
  message: T,
  channel: string,
) => void | Promise<void>;

export type ListenOptions = {
  signal?: AbortSignal;
};
