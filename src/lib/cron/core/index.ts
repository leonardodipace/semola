import { mightThrow, mightThrowSync } from "../../errors/index.js";
import { InvalidRetryError } from "../errors.js";
import {
  type CronBaseOptions,
  type CronOptions,
  type CronOSOptions,
  type CronStatus,
  type ErrorMetadataType,
  type JobPublisher,
  JobWithRetry,
  type NotifyContext,
  type OnFailedAttemptContextType,
  type RetryObserver,
  type RetryOptions,
  type ScheduleType,
} from "./types.js";

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

class CommonCronUtilities {
  public getExpression(schedule: ScheduleType) {
    return ALIASES[schedule] || schedule;
  }

  public getJobName(options: CronBaseOptions) {
    return options.name;
  }

  public next(options: CronBaseOptions, from?: Date | number) {
    const { schedule } = options;
    const exprToParse = this.getExpression(schedule);

    const [parseError, nextMatch] = mightThrowSync(() =>
      Bun.cron.parse(exprToParse, from),
    );

    if (parseError) throw parseError;

    return nextMatch;
  }
}

export class RetryCronJob implements RetryObserver {
  private options: RetryOptions;
  private jobs = new Map<string, number>();

  public constructor(options: RetryOptions) {
    this.options = options;

    if (!this.checkAttempts()) {
      throw new InvalidRetryError(
        "Expected 'maxAttempts' to be a finite non-negative integer",
      );
    }
  }

  public async update(ctx: NotifyContext): Promise<void> {
    if (ctx.type === "add") {
      this.jobs.set(ctx.name, 0);
      return;
    }

    const jobAttempts = this.jobs.get(ctx.name);
    if (jobAttempts === undefined) return;

    if (ctx.type === "success") {
      this.jobs.set(ctx.name, 0);
      return;
    }

    const { job, error, name } = ctx;
    const { maxAttempts } = this.options;
    const onRetryErrorResult = this.runOnRetryError(error, name);
    const hasMoreAttempts = jobAttempts < maxAttempts;
    const canRetry = hasMoreAttempts && onRetryErrorResult;

    if (canRetry) {
      const delay = this.calculateDelay(jobAttempts);

      if (this.options.onFailedAttempt) {
        const context: OnFailedAttemptContextType = {
          attemptNumber: jobAttempts + 1,
          delay,
          error,
          retriesLeft: maxAttempts - jobAttempts,
          jobName: name,
        };

        await this.options.onFailedAttempt(context);
      }

      this.jobs.set(ctx.name, jobAttempts + 1);
      await this.runDelay(delay);

      return;
    }

    job.stop();
    if (!this.options.onError) throw error;

    const data: ErrorMetadataType = {
      name,
      error,
      failedAt: Date.now(),
    };

    await this.options.onError(data);
  }

  private checkAttempts() {
    const { maxAttempts } = this.options;

    const isValidInteger = Number.isSafeInteger(maxAttempts);
    const isNegativeZero = Object.is(maxAttempts, -0);
    const isNaturalNumber = maxAttempts >= 0;

    return isNaturalNumber && isValidInteger && !isNegativeZero;
  }

  private runOnRetryError(error: Error, jobName: string) {
    if (!this.options.retryOnError) return true;
    return this.options.retryOnError({ error, jobName });
  }

  private async runDelay(delay: number) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private calculateDelay(jobAttempt: number) {
    // exponential backoff with "Full Jitter" algorithm

    const deltaTime = BASE_BACKOFF_DELAY * BACKOFF_MULTIPLIER ** jobAttempt;
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

  public async notify(ctx: NotifyContext): Promise<void> {
    if (!this.listener) return;

    await this.listener.update(ctx);
  }
}

export class Cron extends JobWithRetry {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;
  private manager?: RetryManager;
  private common: CommonCronUtilities;

  public constructor(options: CronOptions) {
    super();
    this.options = options;
    this.status = "idle";
    this.common = new CommonCronUtilities();

    if (this.options.retry) {
      this.manager = new RetryManager();
      this.manager.subscribe(this.options.retry);
      this.manager.notify({ type: "add", name: this.getJobName() });
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
      const expr = this.common.getExpression(schedule);

      return Bun.cron(expr, async () => {
        const [handlerError] = await mightThrow(
          Promise.resolve().then(() => handler()),
        );

        if (!handlerError) {
          if (this.manager) {
            await this.manager.notify({
              type: "success",
              name: this.getJobName(),
            });
          }

          return Promise.resolve();
        }

        if (this.manager) {
          const errorContext: NotifyContext = {
            type: "error",
            error: handlerError,
            job: this,
            name: this.getJobName(),
          };

          await this.manager.notify(errorContext);
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

  public getExpression() {
    return this.common.getExpression(this.options.schedule);
  }

  public getJobName() {
    return this.common.getJobName(this.options);
  }

  public next(from?: Date | number) {
    return this.common.next(this.options, from);
  }
}

export class CronOS {
  private options: CronOSOptions;
  private common: CommonCronUtilities;

  public constructor(options: CronOSOptions) {
    this.options = options;
    this.common = new CommonCronUtilities();
  }

  public async run() {
    const { path, schedule, name } = this.options;
    const expr = this.common.getExpression(schedule);

    await Bun.cron(path, expr, name);
  }

  public async stop() {
    await Bun.cron.remove(this.options.name);
  }

  public getExpression() {
    return this.common.getExpression(this.options.schedule);
  }

  public getJobName() {
    return this.common.getJobName(this.options);
  }

  public next(from?: Date | number) {
    return this.common.next(this.options, from);
  }
}
