export type PubSubOptions = {
  redis: Bun.RedisClient;
  channel: string;
};

export type MessageHandler<T> = (
  message: T,
  channel: string,
) => void | Promise<void>;
