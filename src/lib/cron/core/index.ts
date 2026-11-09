import { mightThrow } from "../../errors/index.js";
import { nextRun, parseExpression } from "./schedule.js";
import type {
  CronBaseOptions,
  CronDistributedOptions,
  CronOptions,
  CronOSOptions,
  CronStatus,
  CronUtilitiesInterface,
} from "./types.js";

const DEFAULT_LOCK_TTL = 300_000;
// How often a running job checks the wall clock. A job fires within this long
// after its boundary, also after the machine slept through it.
const CHECK_INTERVAL_MS = 1_000;

const lockKey = (name: string, expr: string, tickMs: number) =>
  `cron:${name}:${expr}:${tickMs}`;

const ALIASES = new Map([
  ["@yearly", "0 0 1 1 *"],
  ["@annually", "0 0 1 1 *"],
  ["@monthly", "0 0 1 * *"],
  ["@weekly", "0 0 * * 0"],
  ["@daily", "0 0 * * *"],
  ["@midnight", "0 0 * * *"],
  ["@hourly", "0 * * * *"],
  ["@minutely", "* * * * *"],
]);

class CommonCronUtilities {
  public getExpression(schedule: string) {
    return ALIASES.get(schedule.trim().toLowerCase()) ?? schedule;
  }

  public getJobName(options: CronBaseOptions) {
    return options.name;
  }

  public next(options: CronBaseOptions, from: Date | number = Date.now()) {
    const expression = this.getExpression(options.schedule);

    return nextRun(parseExpression(expression), from);
  }
}

export class Cron implements CronUtilitiesInterface {
  private options: CronOptions;
  private status: CronStatus;
  private timer: ReturnType<typeof setInterval> | null = null;
  // On the instance, so a handler still running from before a stop() and
  // run() also holds back the new run.
  private isHandling = false;
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

    const expression = this.common.getExpression(this.options.schedule);
    const fields = parseExpression(expression);
    let target = nextRun(fields, Date.now());

    if (!target) {
      throw new TypeError(`Cron expression "${expression}" never matches`);
    }

    // A handler error is rethrown after the next run is set, so it surfaces as
    // an unhandled rejection like Bun.cron does. Handle it (or catch inside the
    // handler) to keep the process alive; the job keeps running either way.
    this.timer = setInterval(async () => {
      if (this.isHandling) return;
      if (!target) return;
      if (Date.now() < target.getTime()) return;

      const scheduledAt = target;
      this.isHandling = true;

      const [handlerError] = await mightThrow(
        Promise.resolve().then(() => this.options.handler(scheduledAt)),
      );

      // Counting from the settle time skips boundaries a slow handler overran.
      // Never counting from before the fired boundary keeps a clock stepped
      // back during the handler from firing it twice.
      target = nextRun(fields, Math.max(Date.now(), scheduledAt.getTime()));
      this.isHandling = false;

      if (handlerError) throw handlerError;
    }, CHECK_INTERVAL_MS);

    this.status = "running";
  }

  public stop() {
    if (this.status !== "running") return;

    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.status = "idle";
  }

  public ref() {
    this.timer?.ref();
  }

  public unref() {
    this.timer?.unref();
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

export class CronDistributed implements CronUtilitiesInterface {
  private cron: Cron;
  private options: CronDistributedOptions;
  private replicaId: string;

  public constructor(options: CronDistributedOptions) {
    this.options = options;
    this.replicaId = options.replicaId ?? crypto.randomUUID();
    this.cron = new Cron({
      name: options.name,
      schedule: options.schedule,
      handler: (scheduledAt) => this.runIfLeader(scheduledAt),
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

  private async runIfLeader(scheduledAt: Date) {
    const key = lockKey(
      this.options.name,
      this.cron.getExpression(),
      scheduledAt.getTime(),
    );
    const lockTTL = this.options.lockTTL ?? DEFAULT_LOCK_TTL;

    const acquired = await this.options.redis.send("SET", [
      key,
      this.replicaId,
      "PX",
      String(lockTTL),
      "NX",
    ]);

    if (acquired !== "OK") return;

    await this.options.handler(scheduledAt);
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
