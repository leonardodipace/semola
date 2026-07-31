import type { InvalidResultError } from "./errors.js";

export type ErrorMetadataType<TRetryResult = void> = {
  failedAt: number;
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
};

export type OnFailedAttemptContextType<TRetryResult = void> = {
  error: Error | InvalidResultError<TRetryResult>;
  attempt: number;
  retriesRemaining: number;
  nextRetryDelayMs: number;
  id: string;
};

export type RetryOnErrorContextType<TRetryResult = void> = {
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
};

export type HookContextType<TRetryResult = void> = {
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
  currentAttempt: number;
  retriesRemaining: number;
};

export type ErrorClassType<E extends Error = Error> = new (
  ...args: never[]
) => E;

export type RetryOptions<TRetryResult> = {
  input: () => TRetryResult | Promise<TRetryResult>;
  maxRetries: number;
  id?: string;
  ignoreErrors?: ErrorClassType[];
  retryErrors?: ErrorClassType[];
  onError?: (error: ErrorMetadataType) => void | Promise<void>;
  onFailedAttempt?: (ctx: OnFailedAttemptContextType) => void | Promise<void>;
  retryOnResult?: (result: TRetryResult) => boolean;
  retryOnError?: (ctx: RetryOnErrorContextType) => boolean;
  beforeRetry?: (ctx: HookContextType<TRetryResult>) => void | Promise<void>;
  afterRetry?: (ctx: HookContextType<TRetryResult>) => void | Promise<void>;
};

export type RetryContext = {
  error: Error;
};
