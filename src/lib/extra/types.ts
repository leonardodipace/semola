import type { InvalidResultError } from "./errors.js";

export type ErrorMetadataType<TRetryResult> = {
  failedAt: number;
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
};

export type OnFailedAttemptContextType<TRetryResult> = {
  error: Error | InvalidResultError<TRetryResult>;
  attempt: number;
  retriesRemaining: number;
  nextRetryDelayMs: number;
  id: string;
};

export type RetryOnErrorContextType<TRetryResult> = {
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
};

export type HookContextType<TRetryResult> = {
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
  retriesRemaining: number;
  attempt: number;
};

export type ErrorClassType<E extends Error = Error> = new (
  ...args: never[]
) => E;

export type RetryOutcomeType<TRetryResult> =
  | { ok: true; result: TRetryResult }
  | { ok: false };

export type BackoffOptions = {
  baseDelay?: number;
  multiplier?: number;
  maxDelay?: number;
};

export type RetryOptions<TRetryResult> = {
  input: () => TRetryResult | Promise<TRetryResult>;
  maxRetries: number;
  id?: string;
  ignoreErrors?: ErrorClassType[];
  retryErrors?: ErrorClassType[];
  backoff?: BackoffOptions;
  onError?: (error: ErrorMetadataType<TRetryResult>) => void | Promise<void>;
  onFailedAttempt?: (
    ctx: OnFailedAttemptContextType<TRetryResult>,
  ) => void | Promise<void>;
  retryOnResult?: (result: TRetryResult) => boolean;
  retryOnError?: (ctx: RetryOnErrorContextType<TRetryResult>) => boolean;
  beforeRetry?: (ctx: HookContextType<TRetryResult>) => void | Promise<void>;
  afterRetry?: (ctx: HookContextType<TRetryResult>) => void | Promise<void>;
};

export type RetryContext = {
  error: Error;
};

export type FuzzyOptions = {
  data: string[];
  threshold?: number;
};

export type FuzzyResult = {
  word: string;
  index: number;
  score: number;
};
