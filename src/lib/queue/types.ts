export type Job<T> = {
  id: string;
  data: T;
  attempts: number;
  maxRetries: number;
  createdAt: number;
};

export type JobState<T> = Job<T> & {
  error?: string;
  errorHistory?: Array<{
    attempt: number;
    error: string;
    timestamp: number;
  }>;
};

export type RetryContext<T> = {
  job: Job<T>;
  error: string;
  nextRetryDelayMs: number;
  retriesRemaining: number;
  backoffMultiplier: number;
};

export type ErrorContext<T> = {
  job: Job<T>;
  lastError: string;
  totalDurationMs: number;
  totalAttempts: number;
  errorHistory: Array<{
    attempt: number;
    error: string;
    timestamp: number;
  }>;
};

export type ParseErrorContext = {
  rawJobData: string;
  parseError: string;
  timestamp: number;
};

export type QueueOptions<T> = {
  name: string;
  redis: Bun.RedisClient;
  handler: (data: T, signal?: AbortSignal) => void | Promise<void>;
  onSuccess?: (job: Job<T>) => void | Promise<void>;
  onRetry?: (context: RetryContext<T>) => void | Promise<void>;
  onError?: (context: ErrorContext<T>) => void | Promise<void>;
  onParseError?: (context: ParseErrorContext) => void | Promise<void>;
  retries?: number;
  timeout?: number;
  concurrency?: number;
  pollInterval?: number;
};
