import { mightThrowSync } from "../errors/index.js";
import type { CronOptions, CronStatus } from "./types.js";

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@minutely": "* * * * *",
};

export class Cron {
  private options: CronOptions;
  private status: CronStatus = "idle";
  private timeoutId: NodeJS.Timeout | null = null;

  // Array-based storage (0 = don't run, 1 = run)
  private second = Array(60).fill(0);
  private minute = Array(60).fill(0);
  private hour = Array(24).fill(0);
  private day = Array(31).fill(0);
  private month = Array(12).fill(0);
  private dayOfWeek = Array(7).fill(0);

  private fillRange(values: number[], min: number, max: number) {
    for (let i = min; i <= max; i++) {
      values[i] = 1;
    }
  }

  private handleList(part: string, values: number[], min: number, max: number) {
    const items = part.split(",");

    for (const item of items) {
      const n = Number(item);

      if (!Number.isInteger(n)) return false;
      if (n < min) return false;
      if (n > max) return false;

      values[n] = 1;
    }

    return true;
  }

  private handleStep(part: string, values: number[], min: number, max: number) {
    const [rangePart, stepStr] = part.split("/");

    if (!rangePart) return false;
    if (!stepStr) return false;

    const step = Number(stepStr);

    if (!Number.isInteger(step)) return false;
    if (step <= 0) return false;

    if (rangePart === "*") {
      for (let i = min; i <= max; i += step) {
        values[i] = 1;
      }

      return true;
    }

    if (rangePart.includes("-")) {
      return this.handleStepRange(rangePart, step, values, min, max);
    }

    return this.handleStepSingle(rangePart, step, values, min, max);
  }

  private handleStepRange(
    range: string,
    step: number,
    values: number[],
    min: number,
    max: number,
  ) {
    const [startStr, endStr] = range.split("-");

    if (!startStr) return false;
    if (!endStr) return false;

    const start = Number(startStr);
    const end = Number(endStr);

    if (!Number.isInteger(start)) return false;
    if (!Number.isInteger(end)) return false;

    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) {
        values[i] = 1;
      }
    }

    return true;
  }

  private handleStepSingle(
    value: string,
    step: number,
    values: number[],
    min: number,
    max: number,
  ) {
    const start = Number(value);

    if (!Number.isInteger(start)) return false;
    if (start < min) return false;
    if (start > max) return false;

    for (let i = start; i <= max; i += step) {
      values[i] = 1;
    }

    return true;
  }

  private handleRange(
    part: string,
    values: number[],
    min: number,
    max: number,
  ) {
    const [startStr, endStr] = part.split("-");

    if (!startStr) return false;
    if (!endStr) return false;

    const start = Number(startStr);
    const end = Number(endStr);

    if (!Number.isInteger(start)) return false;
    if (!Number.isInteger(end)) return false;
    if (start < min) return false;
    if (end > max) return false;
    if (start > end) return false;

    for (let i = start; i <= end; i++) {
      values[i] = 1;
    }

    return true;
  }

  private handleNumber(
    value: string,
    values: number[],
    min: number,
    max: number,
  ) {
    const n = Number(value);

    if (!Number.isInteger(n)) return false;
    if (n < min) return false;
    if (n > max) return false;

    values[n] = 1;

    return true;
  }

  public constructor(options: CronOptions) {
    this.options = options;

    const expr = this.resolveAlias(options.schedule);

    if (!this.parse(expr)) {
      throw new Error("Invalid cron expression");
    }
  }

  private resolveAlias(schedule: string) {
    return ALIASES[schedule] || schedule;
  }

  private parse(expr: string) {
    const parts = expr.trim().split(/\s+/);

    if (parts.length !== 5 && parts.length !== 6) return false;

    // Reset arrays
    this.second.fill(0);
    this.minute.fill(0);
    this.hour.fill(0);
    this.day.fill(0);
    this.month.fill(0);
    this.dayOfWeek.fill(0);

    const fiveFieldSchema = [
      this.minute,
      this.hour,
      this.day,
      this.month,
      this.dayOfWeek,
    ];

    const sixFieldSchema = [
      this.second,
      this.minute,
      this.hour,
      this.day,
      this.month,
      this.dayOfWeek,
    ];

    const fiveFieldBounds = [
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];

    const sixFieldBounds = [
      [0, 59],
      [0, 59],
      [0, 23],
      [1, 31],
      [1, 12],
      [0, 6],
    ];

    const fields = parts.length === 6 ? sixFieldSchema : fiveFieldSchema;
    const bounds = parts.length === 6 ? sixFieldBounds : fiveFieldBounds;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (!part) return false;

      const values = fields[i];
      const bound = bounds[i];

      if (!bound) return false;
      if (bound.length !== 2) return false;
      if (!values) return false;
      if (typeof bound[0] !== "number") return false;
      if (typeof bound[1] !== "number") return false;

      const min = bound[0];
      const max = bound[1];

      if (part === "*") {
        this.fillRange(values, min, max);

        continue;
      }

      if (part.includes(",")) {
        if (!this.handleList(part, values, min, max)) return false;

        continue;
      }

      if (part.includes("/")) {
        if (!this.handleStep(part, values, min, max)) return false;

        continue;
      }

      if (part.includes("-")) {
        if (!this.handleRange(part, values, min, max)) return false;

        continue;
      }

      if (!this.handleNumber(part, values, min, max)) return false;
    }

    return true;
  }

  private matches(date: Date) {
    const s = date.getSeconds();
    const m = date.getMinutes();
    const h = date.getHours();
    const d = date.getDate();
    const mon = date.getMonth();
    const dow = date.getDay();

    const isSecondMatch = this.second[s] === 1;
    const isMinuteMatch = this.minute[m] === 1;
    const isHourMatch = this.hour[h] === 1;
    const isDayMatch = this.day[d - 1] === 1;
    const isMonthMatch = this.month[mon] === 1;
    const isDayOfWeekMatch = this.dayOfWeek[dow] === 1;

    return (
      isSecondMatch &&
      isMinuteMatch &&
      isHourMatch &&
      isDayMatch &&
      isMonthMatch &&
      isDayOfWeekMatch
    );
  }

  private getNextRun() {
    const now = new Date();
    const date = new Date(now);

    // Start from next minute/second
    if (this.second.length === 60) {
      date.setMilliseconds(0);
      date.setSeconds(date.getSeconds() + 1);
    } else {
      date.setSeconds(0, 0);
      date.setMinutes(date.getMinutes() + 1);
    }

    // Search for next 24 hours max
    const maxIterations = this.second.length === 60 ? 86400 : 1440;

    for (let i = 0; i < maxIterations; i++) {
      if (this.matches(date)) {
        const freshNow = new Date();

        if (date > freshNow) {
          return new Date(date);
        }
      }

      // Increment time
      if (this.second.length === 60) {
        date.setSeconds(date.getSeconds() + 1);
      } else {
        date.setMinutes(date.getMinutes() + 1);
      }
    }

    return null;
  }

  public start() {
    if (this.status === "running") return;

    this.status = "running";
    this.next();
  }

  public stop() {
    this.status = "idle";

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  public pause() {
    if (this.status !== "running") return;

    this.status = "paused";

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  public resume() {
    if (this.status !== "paused") return;

    this.status = "running";
    this.next();
  }

  public getStatus() {
    return this.status;
  }

  private next() {
    if (this.status !== "running") return;

    const nextRun = this.getNextRun();

    if (!nextRun) return;

    const delay = nextRun.getTime() - Date.now();

    const actualDelay = Math.max(0, delay);

    this.timeoutId = setTimeout(() => {
      this.run();
    }, actualDelay);
  }

  private async run() {
    if (this.status !== "running") return;

    mightThrowSync(() => this.options.handler());

    if (this.status === "running") {
      this.next();
    }
  }
}
