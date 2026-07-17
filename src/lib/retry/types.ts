export type BaseErrorMetadata = {
  failedAt: number;
  error: Error;
};

export type ErrorMetadataType = BaseErrorMetadata & {
  id: string;
};

export type BaseOnFailedAttemptContext = {
  error: Error;
  attemptNumber: number;
  retriesLeft: number;
  delay: number;
};

export type OnFailedAttemptContextType = BaseOnFailedAttemptContext & {
  id: string;
};

export type BaseRetryOnErrorContext = {
  error: Error;
};

export type RetryOnErrorContextType = BaseRetryOnErrorContext & {
  id: string;
};

export type RetryOptions = {
  maxRetries: number;
  id?: string;
  onError?: (error: ErrorMetadataType) => void | Promise<void>;
  onFailedAttempt?: (ctx: OnFailedAttemptContextType) => void | Promise<void>;
  retryOnError?: (ctx: RetryOnErrorContextType) => boolean;
};

export type RetryFnType<RetryValue> = () => RetryValue | Promise<RetryValue>;

export type RetryContext = {
  error: Error;
};
