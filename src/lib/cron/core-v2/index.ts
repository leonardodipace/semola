import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type { CronOptions, CronStatus, ErrorMetadataType } from "./types.js";

const MINUTELY_EXPR = "* * * * *" as const;

export class CronV2 {
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
    const { schedule, handler } = this.options;
    const [scheduleFormatErr, cron] = mightThrowSync(() => {
      if (schedule === "@minutely") {
        return Bun.cron(MINUTELY_EXPR, handler);
      }

      return Bun.cron(schedule, handler);
    });

    if (scheduleFormatErr) {
      this.status = "idle";
      if (!this.options.onError) throw scheduleFormatErr;

      const data: ErrorMetadataType = {
        name: this.options.name,
        error: scheduleFormatErr as Error,
        failedAt: Date.now(),
      };

      this.options.onError(data);

      return;
    }

    if (cron) {
      this.status = "running";
    }

    this.cron = cron;
  }

  public async runOSLevel(path: string) {
    const { schedule, name } = this.options;
    const expr = schedule === "@minutely" ? MINUTELY_EXPR : schedule;
    const osJob = Bun.cron(path, expr, name);

    const [osError] = await mightThrow(osJob);
    if (!osError) return;

    if (osError) {
      this.status = "idle";
      if (!this.options.onError) throw osError;

      const data: ErrorMetadataType = {
        name: this.options.name,
        error: osError as Error,
        failedAt: Date.now(),
      };

      this.options.onError(data);
      return;
    }
  }

  public async stopOSLevel() {
    this.status = "idle";
    await Bun.cron.remove(this.options.name);
  }

  public getExpression() {
    if (!this.cron) return undefined;
    return this.cron.cron;
  }

  public stop() {
    if (this.status !== "running") return;
    if (!this.cron) return;

    this.status = "idle";
    this.cron.stop();
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
}
