import { mightThrow } from "../../errors/index.js";
import { UnsupportedRuntimeError } from "../errors.js";
import { nextRun, parseExpression } from "./schedule.js";
import type {
  CronBaseOptions,
  CronDistributedOptions,
  CronFields,
  CronOptions,
  CronOSOptions,
  CronStatus,
  CronTimer,
  CronUtilitiesInterface,
  ScheduleType,
} from "./types.js";

// Short lookbacks for replicas that fire seconds after the scheduled boundary.
const TICK_LOOKBACK_MS = [5_000, 60_000] as const;
const DEFAULT_LOCK_TTL = 300_000;
// Timers count monotonic time, which stops while the machine sleeps. Waiting in
// short steps and re-checking the wall clock keeps a job from firing hours late
// after a resume, and stays under setTimeout's 32-bit limit.
const MAX_TIMER_DELAY_MS = 60_000;

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

// OS-level scheduling (crontab, launchd, Task Scheduler) only exists in Bun.
const requireBun = () => {
  if (typeof Bun !== "undefined") return;

  throw new UnsupportedRuntimeError("CronOS requires Bun (uses Bun.cron)");
};

class CommonCronUtilities {
  public getExpression(schedule: ScheduleType) {
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
  private timer: CronTimer | null = null;
  private isUnref = false;
  // Bumped on every run() and stop() so a handler that settles after a stop
  // cannot schedule a stale timer.
  private runId = 0;
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
    const first = nextRun(fields, Date.now());

    if (!first) {
      throw new TypeError(`Cron expression "${expression}" never matches`);
    }

    this.status = "running";
    this.isUnref = false;
    this.runId += 1;
    this.arm(fields, first, this.runId);
  }

  public stop() {
    if (this.status !== "running") return;

    if (this.timer) clearTimeout(this.timer);

    this.timer = null;
    this.runId += 1;
    this.status = "idle";
  }

  public ref() {
    if (this.status !== "running") return;

    this.isUnref = false;
    this.timer?.ref();
  }

  public unref() {
    if (this.status !== "running") return;

    this.isUnref = true;
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

  private arm(fields: CronFields, target: Date, runId: number) {
    const remaining = Math.max(target.getTime() - Date.now(), 0);
    const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);

    this.timer = setTimeout(() => this.wake(fields, target, runId), delay);

    if (this.isUnref) this.timer.unref();
  }

  // A handler error is rethrown after rescheduling, so it surfaces as an
  // unhandled rejection like Bun.cron does. Handle it (or catch inside the
  // handler) to keep the process alive; the job keeps running either way.
  private async wake(fields: CronFields, target: Date, runId: number) {
    // Timers can fire a millisecond early, and waits arrive in steps.
    if (Date.now() < target.getTime()) {
      this.arm(fields, target, runId);

      return;
    }

    const [handlerError] = await mightThrow(
      Promise.resolve().then(() => this.options.handler()),
    );

    // Counting from the settle time skips boundaries a slow handler overran, so
    // runs never overlap or pile up. A stop() or restart meanwhile ends this run.
    if (runId === this.runId) {
      const following = nextRun(fields, Math.max(Date.now(), target.getTime()));

      if (following) this.arm(fields, following, runId);
      if (!following) this.stop();
    }

    if (handlerError) throw handlerError;
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

  private scheduledTick(now = Date.now()) {
    const upcoming = this.cron.next(now);

    if (!upcoming) return null;

    // Gap trick: next fire minus elapsed time to this fire's scheduled boundary.
    const probes = [
      now - (upcoming.getTime() - now),
      ...TICK_LOOKBACK_MS.map((lookback) => now - lookback),
    ];

    for (const probe of probes) {
      const candidate = this.cron.next(probe);

      if (!candidate) continue;

      const after = this.cron.next(candidate.getTime());

      if (after?.getTime() === upcoming.getTime()) return candidate;
    }

    return null;
  }

  private async runIfLeader() {
    const tick = this.scheduledTick();

    if (!tick) return;

    const key = lockKey(
      this.options.name,
      this.cron.getExpression(),
      tick.getTime(),
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
    requireBun();

    const { path, schedule, name } = this.options;
    const expr = this.common.getExpression(schedule);

    await Bun.cron(path, expr, name);
  }

  public async stop() {
    requireBun();

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
