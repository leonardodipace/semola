export type PubSubOptions = {
  /** Client for subscribe/unsubscribe. A connection in subscriber mode cannot publish. */
  subscriber: Bun.RedisClient;
  /** Client for publish. Use a separate connection when also subscribing. */
  publisher: Bun.RedisClient;
  channel: string;
};

export type MessageHandler<T> = (
  message: T,
  channel: string,
) => void | Promise<void>;
