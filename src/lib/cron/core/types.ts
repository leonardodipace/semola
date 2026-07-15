import type {
  BaseErrorMetadata,
  BaseOnFailedAttemptContext,
  BaseRetryOnErrorContext,
} from "../../retry/types.js";

type MinutelyAlias = "@minutely";

export type ErrorMetadataType = BaseErrorMetadata & {
  name: string;
  jobId: string;
};

export type ScheduleType = Bun.CronWithAutocomplete | MinutelyAlias;

export type OnFailedAttemptContextType = BaseOnFailedAttemptContext & {
  jobName: string;
  jobId: string;
};

export type RetryOnErrorContextType = BaseRetryOnErrorContext & {
  jobName: string;
  jobId: string;
};

export type RetryOptions = {
  maxAttempts: number;
  onError?: (error: ErrorMetadataType) => void | Promise<void>;
  onFailedAttempt?: (ctx: OnFailedAttemptContextType) => void | Promise<void>;
  retryOnError?: (ctx: RetryOnErrorContextType) => boolean;
};

export type CronBaseOptions = {
  name: string;
  schedule: ScheduleType;
};

export type CronOptions = CronBaseOptions & {
  handler: () => unknown;
  retry?: RetryObserver;
  jobId?: string;
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
  jobId: string;
};

type NotifyAddRetryContext = { type: "add"; jobId: string };
type NotifySuccessContext = { type: "success"; jobId: string };

export type NotifyContext =
  | NotifySuccessContext
  | NotifyErrorContext
  | NotifyAddRetryContext;

export interface RetryObserver {
  update(ctx: NotifyContext): Promise<void>;
}

export interface JobPublisher {
  subscribe(retry: RetryObserver): void;
  unsubscribe(): void;
  notify(ctx: NotifyContext): Promise<void>;
}
