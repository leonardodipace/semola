import type { InvalidResultError } from "./errors.js";

export type ErrorMetadataType = {
  failedAt: number;
  error: Error;
  id: string;
};

export type OnFailedAttemptContextType = {
  error: Error;
  attemptNumber: number;
  retriesLeft: number;
  delay: number;
  id: string;
};

export type RetryOnErrorContextType = {
  error: Error;
  id: string;
};

export type HookContextType<TRetryResult> = {
  error: Error | InvalidResultError<TRetryResult>;
  id: string;
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
