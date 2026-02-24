import { mightThrow } from "../errors/index.js";
import { FieldAmount, Scanner, Token } from "./scanner.js";
import type { CronOptions, CronStatus } from "./types.js";

const RETRY_DELAY_MS = 60 * 60 * 1000; // 1 hour

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@hourly": "0 * * * *",
  "@minutely": "* * * * *",
};

const CronSecondRange = {
  min: 0,
  max: 59,
} as const;

const CronMinuteRange = {
  min: 0,
  max: 59,
} as const;

const CronHourRange = {
  min: 0,
  max: 23,
} as const;

const CronDayRange = {
  min: 1,
  max: 31,
} as const;

const CronMonthRange = {
  min: 1,
  max: 12,
} as const;

const CronDayOfWeekRange = {
  min: 0,
  max: 6,
} as const;

export class Cron {
  private options: CronOptions;
  private status: CronStatus = "idle";
  private timeoutId: NodeJS.Timeout | null = null;

  // Array-based storage using 1-indexed slots (0 = don't run, 1 = run)
  private second = Array<number>(CronSecondRange.max + 1).fill(0); // 0-59
  private minute = Array<number>(CronMinuteRange.max + 1).fill(0); // 0-59
  private hour = Array<number>(CronHourRange.max + 1).fill(0); // 0-23
  private day = Array<number>(CronDayRange.max + 1).fill(0); // indices 1-31 (0 unused)
  private month = Array<number>(CronMonthRange.max + 1).fill(0); // indices 1-12 (0 unused)
  private dayOfWeek = Array<number>(CronDayOfWeekRange.max + 1).fill(0); // 0-6
  private hasSeconds;

  // Fill all values from min to max with 1
  private fillRange(values: number[], min: number, max: number) {
    for (let i = min; i <= max; i++) {
      values[i] = 1;
    }
  }

  private handleStep(part: string, values: number[], min: number, max: number) {
    // Split step format into range and step components
    const [rangePart, stepStr] = part.split("/");

    if (!rangePart) return false;
    if (!stepStr) return false;

    const step = Number(stepStr);

    // Validate step is a positive integer
    if (!Number.isInteger(step)) return false;
    if (step <= 0) return false;

    if (rangePart === "*") {
      // Wildcard with step: apply step across entire range
      for (let i = min; i <= max; i += step) {
        values[i] = 1;
      }

      return true;
    }

    if (rangePart.includes("-")) {
      // Range with step: delegate to specialized handler
      return this.handleStepRange(rangePart, step, values, min, max);
    }

    // Single value with step: delegate to specialized handler
    return this.handleStepSingle(rangePart, step, values, min, max);
  }

  private handleStepRange(
    range: string,
    step: number,
    values: number[],
    min: number,
    max: number,
  ) {
    // Split range into start and end values
    const [startStr, endStr] = range.split("-");

    if (!startStr) return false;
    if (!endStr) return false;

    let start = min;
    if (startStr.length > 0) {
      start = Number(startStr);
    }

    const end = Number(endStr);

    // Validate range boundaries are integers within bounds
    if (!Number.isInteger(start)) return false;
    if (!Number.isInteger(end)) return false;
    if (start < min) return false;
    if (end > max) return false;
    if (start > end) return false;

    // Apply step through range
    for (let i = start; i <= end; i += step) {
      values[i] = 1;
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

    // Validate starting value is an integer within bounds
    if (!Number.isInteger(start)) return false;
    if (start < min) return false;
    if (start > max) return false;

    // Apply step from start to end of range
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
    // Split range into start and end values
    const [startStr, endStr] = part.split("-");

    if (!startStr) return false;
    if (!endStr) return false;

    const start = Number(startStr);
    const end = Number(endStr);

    // Validate range boundaries are integers within bounds
    if (!Number.isInteger(start)) return false;
    if (!Number.isInteger(end)) return false;
    if (start < min) return false;
    if (end > max) return false;
    if (start > end) return false;

    // Mark all values in the range
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

    // Validate value is an integer within bounds
    if (!Number.isInteger(n)) return false;
    if (n < min) return false;
    if (n > max) return false;

    values[n] = 1;

    return true;
  }

  public constructor(options: CronOptions) {
    this.options = options;

    // Resolve alias or use raw expression
    const expr = this.resolveAlias(options.schedule);
    const [error, tokens] = new Scanner(expr).scan();
    if (error) throw new Error(`${error.type}: ${error.message}`);

    this.hasSeconds = expr.length === FieldAmount.max;

    // Parse and validate the cron expression
    if (!this.parse(tokens)) {
      throw new Error("Invalid cron expression");
    }
  }

  // Map alias to standard cron expression if present
  private resolveAlias(schedule: string) {
    return ALIASES[schedule] || schedule;
  }

  private parse(tokens: Token[]) {
    // Reset arrays
    this.second.fill(0);
    this.minute.fill(0);
    this.hour.fill(0);
    this.day.fill(0);
    this.month.fill(0);
    this.dayOfWeek.fill(0);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) return false;

      switch (token.getField()) {
        case "second": {
          const success = this.handleField(
            token,
            this.second,
            CronSecondRange.min,
            CronSecondRange.max,
          );

          if (!success) return false;
          break;
        }
        case "minute": {
          const success = this.handleField(
            token,
            this.minute,
            CronMinuteRange.min,
            CronMinuteRange.max,
          );

          if (!success) return false;
          break;
        }
        case "hour": {
          const success = this.handleField(
            token,
            this.hour,
            CronHourRange.min,
            CronHourRange.max,
          );

          if (!success) return false;
          break;
        }
        case "day": {
          const success = this.handleField(
            token,
            this.day,
            CronDayRange.min,
            CronDayRange.max,
          );

          if (!success) return false;
          break;
        }
        case "month": {
          const success = this.handleField(
            token,
            this.month,
            CronMonthRange.min,
            CronMonthRange.max,
          );

          if (!success) return false;
          break;
        }
        case "weekday": {
          const success = this.handleField(
            token,
            this.dayOfWeek,
            CronDayOfWeekRange.min,
            CronDayOfWeekRange.max,
          );

          if (!success) return false;
          break;
        }
        default:
          return false;
      }
    }

    return true;
  }

  private handleField(token: Token, field: number[], min: number, max: number) {
    let success = true;
    switch (token.getTokenType()) {
      case "any": {
        this.fillRange(field, min, max);
        break;
      }
      case "number": {
        success = this.handleNumber(token.getComponent(), field, min, max);
        break;
      }
      case "range": {
        const component = token.getComponent();
        success = this.handleRange(component, field, min, max);
        break;
      }
      case "step": {
        const component = token.getComponent();
        success = this.handleStep(component, field, min, max);
        break;
      }
      default:
        return false;
    }

    return success;
  }

  public matches(date: Date) {
    // Extract date/time components
    const s = date.getSeconds();
    const m = date.getMinutes();
    const h = date.getHours();
    const d = date.getDate();
    const mon = date.getMonth();
    const dow = date.getDay();

    // Check each component against configured values
    const isSecondMatch = this.hasSeconds ? this.second[s] === 1 : true;
    const isMinuteMatch = this.minute[m] === 1;
    const isHourMatch = this.hour[h] === 1;
    const isDayMatch = this.day[d] === 1;
    const isMonthMatch = this.month[mon + 1] === 1;
    const isDayOfWeekMatch = this.dayOfWeek[dow] === 1;

    // All conditions must match
    return (
      isSecondMatch &&
      isMinuteMatch &&
      isHourMatch &&
      isDayMatch &&
      isMonthMatch &&
      isDayOfWeekMatch
    );
  }

  public getNextRun() {
    const now = new Date();
    const date = new Date(now);

    // Start from next minute/second
    if (this.hasSeconds) {
      date.setMilliseconds(0);
      date.setSeconds(date.getSeconds() + 1);
    } else {
      date.setSeconds(0, 0);
      date.setMinutes(date.getMinutes() + 1);
    }

    // Search up to 366 days to cover yearly/leap-year schedules
    const maxIterations = this.hasSeconds ? 366 * 24 * 3600 : 366 * 24 * 60;

    for (let i = 0; i < maxIterations; i++) {
      if (this.matches(date)) {
        const freshNow = new Date();

        // Ensure match is still in the future
        if (date > freshNow) {
          return new Date(date);
        }
      }

      // Increment time
      if (this.hasSeconds) {
        date.setSeconds(date.getSeconds() + 1);
      } else {
        date.setMinutes(date.getMinutes() + 1);
      }
    }

    return null;
  }

  public start() {
    if (this.status !== "idle") return;

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

    if (!nextRun) {
      this.timeoutId = setTimeout(() => this.next(), RETRY_DELAY_MS);
      return;
    }

    const delay = nextRun.getTime() - Date.now();

    const actualDelay = Math.max(0, delay);

    this.timeoutId = setTimeout(() => {
      this.run();
    }, actualDelay);
  }

  private async run() {
    if (this.status !== "running") return;

    const handlerResult = this.options.handler();
    await mightThrow(Promise.resolve(handlerResult));

    if (this.status === "running") {
      this.next();
    }
  }
}
