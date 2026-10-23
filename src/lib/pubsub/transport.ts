import { mightThrow } from "../errors/index.js";
import type { ChannelHandler, ChannelTransport } from "./types.js";

const memorySubscriptions = new Map<string, Set<ChannelHandler>>();

export const memoryTransport: ChannelTransport = {
  publish: async (channel, message) => {
    const handlers = memorySubscriptions.get(channel);

    if (!handlers) {
      return 0;
    }

    const snapshot = [...handlers];

    for (const handler of snapshot) {
      await mightThrow(Promise.resolve().then(() => handler(message, channel)));
    }

    return snapshot.length;
  },

  subscribe: async (channel, handler) => {
    const handlers = memorySubscriptions.get(channel) ?? new Set();

    handlers.add(handler);
    memorySubscriptions.set(channel, handlers);

    return handlers.size;
  },

  unsubscribe: async (channel, handler) => {
    const handlers = memorySubscriptions.get(channel);

    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    if (handlers.size === 0) {
      memorySubscriptions.delete(channel);
    }
  },
};

export const createRedisTransport = (
  publisher: Bun.RedisClient,
  subscriber: Bun.RedisClient,
): ChannelTransport => {
  return {
    publish: (channel, message) => publisher.publish(channel, message),
    subscribe: (channel, handler) => subscriber.subscribe(channel, handler),
    unsubscribe: (channel) => subscriber.unsubscribe(channel),
  };
};
