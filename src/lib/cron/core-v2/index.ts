import { mightThrow, mightThrowSync } from "../../errors/index.js";
import {
  type CronOptions,
  type CronStatus,
  type ErrorMetadataType,
  type JobPublisher,
  JobWithRetry,
  type RetryObserver,
  type ScheduleType,
} from "./types.js";

const MINUTELY_EXPR = "* * * * *";
const DEFAULT_MAX_ATTEMPTS = 5;
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

class RetryManager implements JobPublisher {
  private listener: RetryObserver | null = null;

  public subscribe(listener: RetryObserver): void {
    this.listener = listener;
  }

  public unsubscribe(): void {
    this.listener = null;
  }

  public notify(job: JobWithRetry): void {
    if (!this.listener) return;

    this.listener.update(job);
  }
}

export class RetryCronJob implements RetryObserver {
  private maxAttempts: number;

  public constructor(maxAttempts?: number) {
    this.maxAttempts = maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  public update(job: Cron): void {
    if (job.getCurrentAttempt() < this.maxAttempts) {
      return;
    }

    job.stop();
  }
}

export class RetryOSCronJob implements RetryObserver {
  private maxAttempts: number;

  public constructor(maxAttempts?: number) {
    this.maxAttempts = maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  public update(job: Cron): void {
    if (job.getCurrentAttempt() < this.maxAttempts) {
      return;
    }

    job.stopOSLevel();
  }
}

export class Cron extends JobWithRetry {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;
  private manager: RetryManager;
  private attempt: number;

  public constructor(options: CronOptions) {
    super();
    this.options = options;
    this.status = "idle";
    this.attempt = 1;
    this.manager = new RetryManager();

    if (this.options.retryHandler) {
      this.manager.subscribe(this.options.retryHandler);
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

        await Promise.resolve(this.launchError(handlerError));
      });
    });

    if (!scheduleFormatErr) {
      this.status = "running";
      this.cron = cron;

      return;
    }

    this.launchError(scheduleFormatErr);
  }

  public stop() {
    if (this.status !== "running") return;
    if (!this.cron) return;

    this.cron.stop();
    this.status = "idle";
  }

  public async runOSLevel(path: string) {
    if (this.status === "running") return;

    const { schedule, name } = this.options;
    const expr = schedule === "@minutely" ? MINUTELY_EXPR : schedule;

    const [createError, osJob] = mightThrowSync(() =>
      Bun.cron(path, expr, name),
    );

    if (createError) {
      this.launchError(createError);
      return;
    }

    const [osError] = await mightThrow(osJob);

    if (osError) {
      this.launchError(osError);
      return;
    }

    this.status = "running";
  }

  public async stopOSLevel() {
    const [rmError, rmResult] = mightThrowSync(() =>
      Bun.cron.remove(this.options.name),
    );

    if (!rmError) {
      await rmResult;
      this.status = "idle";
      return;
    }

    this.launchError(rmError);
  }

  public getExpression() {
    if (!this.cron) {
      // Used in case we are running an OS-level job
      return ALIASES[this.options.schedule] || this.options.schedule;
    }

    return this.cron.cron;
  }

  public getCurrentAttempt() {
    return this.attempt;
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

    if (parseError) this.launchError(parseError);

    return nextMatch;
  }

  private launchError(error: Error) {
    this.manager.notify(this);
    this.attempt += 1;
    if (!this.options.onError) throw error;

    const data: ErrorMetadataType = {
      name: this.options.name,
      error: error,
      failedAt: Date.now(),
    };

    this.options.onError(data);
  }
}
