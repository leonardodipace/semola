export type QueueOptions<T> = {
  name: string;
  redis: Bun.RedisClient;
  handler: (data: T, signal?: AbortSignal) => void | Promise<void>;
  onSuccess?: (job: Job<T>) => void | Promise<void>;
  onRetry?: (job: Job<T>) => void | Promise<void>;
  onError?: (job: Job<T>) => void | Promise<void>;
  retries?: number;
  timeout?: number;
  concurrency?: number;
  pollInterval?: number;
};

export type Job<T> = {
  id: string;
  data: T;
  attempts: number;
  maxRetries: number;
  createdAt: number;
  error?: string;
};
