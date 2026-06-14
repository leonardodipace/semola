import { mightThrow, mightThrowSync } from "../../errors/index.js";
import {
  type CronOptions,
  type CronStatus,
  type ErrorMetadataType,
  type JobPublisher,
  JobWithRetry,
  type OnFailedAttemptContextType,
  type RetryObserver,
  type RetryOptions,
  type ScheduleType,
} from "./types.js";

const MINUTELY_EXPR = "* * * * *";
const BASE_BACKOFF_DELAY = 1000;
const MAX_BACKOFF_DELAY = 1000 * 60; // 1 minute
const BACKOFF_MULTIPLIER = 2;

const ALIASES: Record<ScheduleType, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@minutely": "* * * * *",
} as const;

class InvalidRetryError extends TypeError {}

export class RetryCronJob implements RetryObserver {
  private options: RetryOptions;
  private currentAttempt: number;

  public constructor(options: RetryOptions) {
    this.options = options;
    this.currentAttempt = 0;
  }

  public async update(job: Cron, error: Error): Promise<void> {
    if (!this.checkAttempts()) {
      job.stop();
      throw new InvalidRetryError(
        "Exppected 'maxRetries' to be greater or equal than zero or not NaN",
      );
    }

    const { maxAttempts } = this.options;
    const onRetryErrorResult = this.runOnRetryError(error);
    const hasMoreAttempts = this.currentAttempt < maxAttempts;
    const canRetry = hasMoreAttempts && onRetryErrorResult;

    if (canRetry) {
      const delay = this.calculateDelay();

      if (this.options.onFailedAttempt) {
        const context: OnFailedAttemptContextType = {
          attemptNumber: this.currentAttempt + 1,
          delay,
          error,
          retriesLeft: maxAttempts - this.currentAttempt,
        };

        await this.options.onFailedAttempt(context);
        this.currentAttempt += 1;
      }

      await this.runDelay(delay);

      return;
    }

    job.stop();
    if (!this.options.onError) throw error;

    const data: ErrorMetadataType = {
      name: job.getJobName(),
      error: error,
      failedAt: Date.now(),
    };

    await this.options.onError(data);
  }

  private checkAttempts() {
    const { maxAttempts } = this.options;

    const isNegativeZero = Object.is(maxAttempts, -0);
    const isNaturalNumber = maxAttempts >= 0;
    const isNan = Number.isNaN(maxAttempts);

    return isNaturalNumber && !isNan && !isNegativeZero;
  }

  private runOnRetryError(error: Error) {
    if (!this.options.retryOnError) return true;

    return this.options.retryOnError(error);
  }

  private async runDelay(delay: number) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private calculateDelay() {
    // exponential backoff with "Full Jitter" algorithm

    const deltaTime =
      BASE_BACKOFF_DELAY * BACKOFF_MULTIPLIER ** (this.currentAttempt - 1);

    const minDeltaTime = Math.min(deltaTime, MAX_BACKOFF_DELAY);
    return Math.round(Math.random() * (minDeltaTime + 1));
  }
}

class RetryManager implements JobPublisher {
  private listener: RetryObserver | null = null;

  public subscribe(listener: RetryObserver): void {
    this.listener = listener;
  }

  public unsubscribe(): void {
    this.listener = null;
  }

  public async notify(job: JobWithRetry, error: Error): Promise<void> {
    if (!this.listener) return;

    await this.listener.update(job, error);
  }
}

export class Cron extends JobWithRetry {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;
  private manager?: RetryManager;

  public constructor(options: CronOptions) {
    super();
    this.options = options;
    this.status = "idle";

    if (this.options.retry) {
      this.manager = new RetryManager();
      this.manager.subscribe(this.options.retry);
    }
  }

  public [Symbol.dispose](): void {
    this.stop();
  }

  public getStatus() {
    return this.status;
  }

  public run() {
    if (this.status === "running") return;

    const { schedule, handler } = this.options;
    const [scheduleFormatErr, cron] = mightThrowSync(() => {
      const expr = schedule === "@minutely" ? MINUTELY_EXPR : schedule;

      return Bun.cron(expr, async () => {
        const [handlerError] = await mightThrow(
          Promise.resolve().then(() => handler()),
        );

        if (!handlerError) return Promise.resolve();

        if (this.manager) {
          await this.manager.notify(this, handlerError);
          return;
        }

        await Promise.reject(handlerError);
      });
    });

    if (!scheduleFormatErr) {
      this.status = "running";
      this.cron = cron;

      return;
    }

    throw scheduleFormatErr;
  }

  public stop() {
    if (this.status !== "running") return;
    if (!this.cron) return;

    this.cron.stop();
    this.status = "idle";
  }

  public getExpression() {
    return ALIASES[this.options.schedule] || this.options.schedule;
  }

  public getJobName() {
    return this.options.name;
  }

  public ref() {
    if (this.status !== "running") return;
    if (!this.cron) return;

    this.cron.ref();
  }

  public unref() {
    if (this.status !== "running") return;
    if (!this.cron) return;

    this.cron.unref();
  }

  public next(from?: Date | number) {
    const { schedule } = this.options;
    const exprToParse = schedule === "@minutely" ? MINUTELY_EXPR : schedule;

    const [parseError, nextMatch] = mightThrowSync(() =>
      Bun.cron.parse(exprToParse, from),
    );

    if (parseError) throw parseError;

    return nextMatch;
  }
}
