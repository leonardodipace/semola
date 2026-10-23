import type { ChannelHandler, ChannelTransport } from "./types.js";

// ponytail: process-wide hub; Redis when you need cross-process
const memorySubscriptions = new Map<string, Set<ChannelHandler>>();

export const memoryTransport: ChannelTransport = {
  publish: async (channel, message) => {
    const handlers = memorySubscriptions.get(channel);

    if (!handlers) {
      return 0;
    }

    let count = 0;

    for (const handler of handlers) {
      await handler(message, channel);
      count += 1;
    }

    return count;
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
