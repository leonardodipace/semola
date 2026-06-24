type MinutelyAlias = "@minutely";

export type ErrorMetadataType = {
  name: string;
  failedAt: number;
  error: Error;
};

export type ScheduleType = Bun.CronWithAutocomplete | MinutelyAlias;

export type OnFailedAttemptContextType = {
  error: Error;
  attemptNumber: number;
  retriesLeft: number;
  delay: number;
};

export type RetryOptions = {
  maxAttempts: number;
  onError?: (error: ErrorMetadataType) => void | Promise<void>;
  onFailedAttempt?: (ctx: OnFailedAttemptContextType) => void | Promise<void>;
  retryOnError?: (error: Error) => boolean;
};

export type CronBaseOptions = {
  name: string;
  schedule: ScheduleType;
};

export type CronOptions = CronBaseOptions & {
  handler: () => unknown;
  retry?: RetryObserver;
};

export type CronOSOptions = CronBaseOptions & {
  path: string;
};

export type CronStatus = "idle" | "running";

export abstract class JobWithRetry {
  protected constructor() {}
  public abstract run(): void;
  public abstract stop(): void;
}

type NotifyErrorContext = {
  type: "error";
  job: JobWithRetry;
  error: Error;
  name: string;
};

type NotifySuccessContext = { type: "success" };

export type NotifyContext = NotifySuccessContext | NotifyErrorContext;

export interface RetryObserver {
  update(ctx: NotifyContext): Promise<void>;
}

export interface JobPublisher {
  subscribe(retry: RetryObserver): void;
  unsubscribe(): void;
  notify(ctx: NotifyContext): Promise<void>;
}
