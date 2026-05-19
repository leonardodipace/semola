type MinutelyAlias = "@minutely";

export abstract class JobWithRetry {
  protected constructor() {}
}

export interface RetryObserver {
  update(job: JobWithRetry): void;
}

export interface JobPublisher {
  subscribe(retry: RetryObserver): void;
  unsubscribe(): void;
  notify(job: JobWithRetry): void;
}

export type ErrorMetadataType = {
  name: string;
  failedAt: number;
  error: Error;
};

export type ScheduleType =
  | Bun.CronWithAutocomplete
  | MinutelyAlias
  | (string & {});

export type CronOptions = {
  name: string;
  schedule: ScheduleType;
  handler: () => unknown;
  onError?: (error: ErrorMetadataType) => void | Promise<void>;
  retryHandler?: RetryObserver;
};

export type CronStatus = "idle" | "running";
