export type PubSubOptions = {
  subscriber: Bun.RedisClient;
  publisher: Bun.RedisClient;
  channel: string;
};

export type MessageHandler<T> = (
  message: T,
  channel: string,
) => void | Promise<void>;
