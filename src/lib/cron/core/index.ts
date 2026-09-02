import { mightThrow, mightThrowSync } from "../../errors/index.js";
import type {
  CronBaseOptions,
  CronDistributedOptions,
  CronOptions,
  CronOSOptions,
  CronStatus,
  CronUtilitiesInterface,
  ScheduleType,
} from "./types.js";

const DEFAULT_LOCK_TTL = 300_000;
const MAX_SCHEDULE_GAP_MS = 1464 * 24 * 60 * 60 * 1000;

const lockKey = (name: string, tickMs: number) => `cron:${name}:${tickMs}`;

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

  public currentScheduledTick(options: CronBaseOptions, from?: Date | number) {
    const now = from === undefined ? Date.now() : Number(from);
    const upcoming = this.next(options, now);

    if (!upcoming) return null;

    const gap = upcoming.getTime() - now;
    const candidate = this.next(options, now - gap);

    if (candidate) {
      const candidateNext = this.next(options, candidate.getTime());

      if (candidateNext && candidateNext.getTime() === upcoming.getTime()) {
        return candidate;
      }
    }

    return this.previousScheduledTick(options, upcoming);
  }

  private previousScheduledTick(options: CronBaseOptions, upcoming: Date) {
    let lo = 1;
    let hi = MAX_SCHEDULE_GAP_MS;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const probe = this.next(options, upcoming.getTime() - mid);

      if (probe && probe.getTime() < upcoming.getTime()) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }

    const tick = this.next(options, upcoming.getTime() - lo);

    if (!tick) return null;
    if (tick.getTime() >= upcoming.getTime()) return null;

    return tick;
  }
}

export class Cron implements CronUtilitiesInterface {
  private options: CronOptions;
  private status: CronStatus;
  private cron: Bun.CronJob | null = null;
  private common: CommonCronUtilities;

  public constructor(options: CronOptions) {
    this.options = options;
    this.status = "idle";
    this.common = new CommonCronUtilities();
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

        if (!handlerError) return Promise.resolve();
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

  public currentScheduledTick(from?: Date | number) {
    return this.common.currentScheduledTick(this.options, from);
  }
}

export class CronDistributed implements CronUtilitiesInterface {
  private cron: Cron;
  private options: CronDistributedOptions;

  public constructor(options: CronDistributedOptions) {
    this.options = options;
    this.cron = new Cron({
      name: options.name,
      schedule: options.schedule,
      handler: () => this.runIfLeader(),
    });
  }

  public [Symbol.dispose](): void {
    this.stop();
  }

  public getStatus() {
    return this.cron.getStatus();
  }

  public run() {
    this.cron.run();
  }

  public stop() {
    this.cron.stop();
  }

  public ref() {
    this.cron.ref();
  }

  public unref() {
    this.cron.unref();
  }

  public getExpression() {
    return this.cron.getExpression();
  }

  public getJobName() {
    return this.cron.getJobName();
  }

  public next(from?: Date | number) {
    return this.cron.next(from);
  }

  private async runIfLeader() {
    const tick = this.cron.currentScheduledTick();

    if (!tick) return;

    const key = lockKey(this.options.name, tick.getTime());
    const replicaId = this.options.replicaId ?? crypto.randomUUID();
    const lockTTL = this.options.lockTTL ?? DEFAULT_LOCK_TTL;

    const acquired = await this.options.redis.set(
      key,
      replicaId,
      "PX",
      String(lockTTL),
      "NX",
    );

    if (acquired !== "OK") return;

    await this.options.handler();
  }
}

export class CronOS implements CronUtilitiesInterface {
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
