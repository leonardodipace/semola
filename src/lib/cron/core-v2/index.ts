import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type { CronOptions, CronStatus, ErrorMetadataType } from "./types.js";

const MINUTELY_EXPR = "* * * * *";

interface Disposable {
  [Symbol.dispose](): void;
}

export class Cron implements Disposable {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;

  public constructor(options: CronOptions) {
    this.options = options;
    this.status = "idle";
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
