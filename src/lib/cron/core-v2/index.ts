import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type {
  CronOptions,
  CronStatus,
  ErrorMetadataType,
  ScheduleType,
} from "./types.js";

const MINUTELY_EXPR = "* * * * *" as const;

export class Cron {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;

  public constructor(options: CronOptions) {
    this.options = options;
    this.status = "idle";
  }

  public getStatus() {
    return this.status;
  }

  public run() {
    if (this.status === "running") return;

    const { schedule, handler } = this.options;
    const [scheduleFormatErr, cron] = mightThrowSync(() => {
      const expr = schedule === "@minutely" ? MINUTELY_EXPR : schedule;
      return Bun.cron(expr, handler);
    });

    if (!scheduleFormatErr) {
      this.status = "running";
      this.cron = cron;

      return;
    }

    if (!this.options.onError) throw scheduleFormatErr;

    const data: ErrorMetadataType = {
      name: this.options.name,
      error: scheduleFormatErr,
      failedAt: Date.now(),
    };

    this.options.onError(data);
  }

  public async runOSLevel(path: string) {
    if (this.status === "running") return;

    const { schedule, name } = this.options;
    const expr = schedule === "@minutely" ? MINUTELY_EXPR : schedule;
    const osJob = Bun.cron(path, expr, name);

    const [osError] = await mightThrow(osJob);

    if (!osError) {
      this.status = "running";
      return;
    }

    if (!this.options.onError) throw osError;

    const data: ErrorMetadataType = {
      name: this.options.name,
      error: osError,
      failedAt: Date.now(),
    };

    this.options.onError(data);
  }

  public async stopOSLevel() {
    if (this.status !== "running") return;

    await Bun.cron.remove(this.options.name);
    this.status = "idle";
  }

  public getExpression() {
    if (!this.cron) return null;
    return this.cron.cron;
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

  public next(from?: Date | number) {
    if (!this.cron) return null;

    const { schedule } = this.options;
    const exprToParse = schedule === "@minutely" ? MINUTELY_EXPR : schedule;

    return Bun.cron.parse(exprToParse, from);
  }
}
