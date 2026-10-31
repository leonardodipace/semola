import type { ChannelHandler, IoredisLike, RedisClient } from "./types.js";

/**
 * Adapts an ioredis (or similar) client to Semola's Bun-style
 * `subscribe(channel, listener)` Redis client.
 */
export const fromIoredis = (client: IoredisLike): RedisClient => {
  const bridges = new Map<
    ChannelHandler,
    (channel: string, message: string) => void
  >();

  return {
    publish: (channel, message) => client.publish(channel, message),

    subscribe: async (channel, listener) => {
      const bridge = (ch: string, message: string) => {
        if (ch !== channel) return;
        void listener(message, ch);
      };

      bridges.set(listener, bridge);
      client.on("message", bridge);
      await client.subscribe(channel);
    },

    unsubscribe: async (channel, listener) => {
      if (listener) {
        const bridge = bridges.get(listener);

        if (bridge) {
          client.off("message", bridge);
          bridges.delete(listener);
        }
      } else {
        for (const bridge of bridges.values()) {
          client.off("message", bridge);
        }

        bridges.clear();
      }

      await client.unsubscribe(channel);
    },
  };
};
