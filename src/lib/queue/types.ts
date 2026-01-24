export type QueueOptions<T> = {
  name: string;
  redis: Bun.RedisClient;
  retries: number;
  handler: (data: T) => void | Promise<void>;
  onSuccess?: (job: Job<T>) => void | Promise<void>;
  onError?: (job: Job<T>) => void | Promise<void>;
};

export type Job<T> = {
  id: string;
  data: T;
  attempts: number;
  maxRetries: number;
  createdAt: number;
  error?: string;
};
