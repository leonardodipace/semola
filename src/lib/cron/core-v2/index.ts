import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type {
  CronOptions,
  CronStatus,
  ErrorMetadataType,
  RetryOptions,
  ScheduleType,
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

export class Cron {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;
  private currentAttempt: number;

  public constructor(options: CronOptions) {
    this.options = options;
    this.status = "idle";
    this.currentAttempt = 1;
  }

  public [Symbol.dispose](): void {
    this.stop();
  }

  public getStatus() {
    return this.status;
  }

  public run() {
    if (this.status === "running") return;

    const { schedule, handler, maxAttempts } = this.options;
    const avaiableAttempts = maxAttempts ? maxAttempts : DEFAULT_MAX_ATTEMPTS;

    const [scheduleFormatErr, cron] = mightThrowSync(() => {
      const expr = schedule === "@minutely" ? MINUTELY_EXPR : schedule;

      return Bun.cron(expr, async () => {
        const [handlerError] = await mightThrow(
          Promise.resolve().then(() => handler()),
        );

        if (!handlerError) return Promise.resolve();

        this.currentAttempt += 1;
        if (this.currentAttempt > avaiableAttempts) {
          await Promise.reject(this.launchError(handlerError));
        }

        console.log(this.currentAttempt);
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

  public getExpression() {
    return ALIASES[this.options.schedule] || this.options.schedule;
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
    if (!this.options.onError) throw error;

    const data: ErrorMetadataType = {
      name: this.options.name,
      error: error,
      failedAt: Date.now(),
    };

    this.options.onError(data);
  }
}
