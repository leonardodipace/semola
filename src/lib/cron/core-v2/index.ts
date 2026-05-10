import { mightThrow, mightThrowSync } from "../../errors/index.js";

type MinutelyAlias = "@minutely";
const MinuteExpr = "* * * * *" as const;

export type CronOptions = {
  name: string;
  schedule: Bun.CronWithAutocomplete | MinutelyAlias | (string & {});
  handler: () => Promise<unknown>;
  onError?: () => void;
};

export type CronStatus = "idle" | "running";

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
        return Bun.cron(MinuteExpr, handler);
      }

      return Bun.cron(schedule, handler);
    });

    if (scheduleFormatErr) {
      if (!this.options.onError) throw scheduleFormatErr;

      this.options.onError();
      return;
    }

    if (cron) {
      this.status = "running";
    }

    this.cron = cron;
  }

  public async runOSLevel(path: string) {
    const { schedule, name } = this.options;
    const expr = schedule === "@minutely" ? MinuteExpr : schedule;
    const osJob = Bun.cron(path, expr, name);

    const [osError] = await mightThrow(osJob);
    if (!osError) return;

    if (osError) {
      if (!this.options.onError) throw osError;

      this.options.onError();
      return;
    }
  }

  public async stopOSLevel() {
    await Bun.cron.remove(this.options.name);
  }

  public getExpression() {
    if (!this.cron) return undefined;
    return this.cron.cron;
  }

  public stop() {
    if (this.status !== "running") return;
    if (!this.cron) return;

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
