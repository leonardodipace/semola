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

export type ErrorClassType<E extends Error = Error> = new (
  ...args: never[]
) => E;

export type RetryOptions = {
  maxRetries: number;
  id?: string;
  ignoreErrors?: ErrorClassType[];
  retryErrors?: ErrorClassType[];
  onError?: (error: ErrorMetadataType) => void | Promise<void>;
  onFailedAttempt?: (ctx: OnFailedAttemptContextType) => void | Promise<void>;
  retryOnError?: (ctx: RetryOnErrorContextType) => boolean;
};

export type RetryFnType<RetryValue> = () => RetryValue | Promise<RetryValue>;

export type RetryContext = {
  error: Error;
};
