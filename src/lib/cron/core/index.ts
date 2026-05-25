import { mightThrow } from "../../errors/index.js";
import { InvalidValueError, OutOfBoundError } from "../errors.js";
import { FieldAmount, Scanner, type Token } from "./scanner.js";
import type { CronOptions, CronStatus } from "./types.js";

const RETRY_DELAY_MS = 60 * 60 * 1000; // 1 hour
const MAX_YEARS = 4;

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
  private hasSeconds: boolean;
  private _dayWildcard = false;
  private _dowWildcard = false;

  // Fill all values from min to max with 1
  private fillRange(values: number[], min: number, max: number) {
    for (let i = min; i <= max; i++) {
      values[i] = 1;
    }
  }

  private handleStep(part: string, values: number[], min: number, max: number) {
    // Split step format into range and step components
    const [rangePart, stepStr] = part.split("/");

    if (!rangePart) {
      throw new InvalidValueError(`'${rangePart}' is empty`);
    }

    if (!stepStr) {
      throw new InvalidValueError(`'${stepStr}' is empty`);
    }

    const step = Number(stepStr);

    // Validate step is a positive integer
    if (!Number.isInteger(step)) {
      throw new InvalidValueError(`'${step}' is not a valid number`);
    }

    if (step <= 0) {
      throw new OutOfBoundError(`Expected ${step} > 0`);
    }

    if (rangePart === "*") {
      // Wildcard with step: apply step across entire range
      for (let i = min; i <= max; i += step) {
        values[i] = 1;
      }

      return;
    }

    if (rangePart.includes("-")) {
      // Range with step: delegate to specialized handler
      this.handleStepRange(rangePart, step, values, min, max);

      return;
    }

    // Single value with step: delegate to specialized handler
    this.handleStepSingle(rangePart, step, values, min, max);
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

    if (!endStr) {
      throw new InvalidValueError(`'${endStr}' is empty`);
    }

    let start = min;
    if (startStr && startStr.length > 0) {
      start = Number(startStr);
    }

    const end = Number(endStr);

    // Validate range boundaries are integers within bounds
    if (!Number.isInteger(start)) {
      throw new InvalidValueError(`'${start}' is not a valid number`);
    }

    if (!Number.isInteger(end)) {
      throw new InvalidValueError(`'${end}' is not a valid number`);
    }

    if (start < min) {
      throw new OutOfBoundError(`Expected ${start} >= ${min}`);
    }

    if (end > max) {
      throw new OutOfBoundError(`Expected ${end} <= ${max}`);
    }

    if (start > end) {
      throw new OutOfBoundError(`Expected ${start} <= ${end}`);
    }

    // Apply step through range
    for (let i = start; i <= end; i += step) {
      values[i] = 1;
    }
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
    if (!Number.isInteger(start)) {
      throw new InvalidValueError(`'${start}' is not a valid number`);
    }

    if (start < min) {
      throw new OutOfBoundError(`Expected ${start} >= ${min}`);
    }

    if (start > max) {
      throw new OutOfBoundError(`Expected ${start} <= ${max}`);
    }

    // Apply step from start to end of range
    for (let i = start; i <= max; i += step) {
      values[i] = 1;
    }
  }

  private handleRange(
    part: string,
    values: number[],
    min: number,
    max: number,
  ) {
    // Split range into start and end values
    const [startStr, endStr] = part.split("-");

    if (!startStr) {
      throw new InvalidValueError(`'${startStr}' is empty`);
    }

    if (!endStr) {
      throw new InvalidValueError(`'${endStr}' is empty`);
    }

    const start = Number(startStr);
    const end = Number(endStr);

    // Validate range boundaries are integers within bounds
    if (!Number.isInteger(start)) {
      throw new InvalidValueError(`'${start}' is not a valid number`);
    }

    if (!Number.isInteger(end)) {
      throw new InvalidValueError(`'${end}' is not a valid number`);
    }

    if (start < min) {
      throw new OutOfBoundError(`Expected ${start} >= ${min}`);
    }

    if (end > max) {
      throw new OutOfBoundError(`Expected ${end} <= ${max}`);
    }

    if (start > end) {
      throw new OutOfBoundError(`Expected ${start} <= ${end}`);
    }

    // Mark all values in the range
    for (let i = start; i <= end; i++) {
      values[i] = 1;
    }
  }

  private handleNumber(
    value: string,
    values: number[],
    min: number,
    max: number,
  ) {
    const n = Number(value);

    // Validate value is an integer within bounds
    if (!Number.isInteger(n)) {
      throw new InvalidValueError(`'${value}' is not a valid number`);
    }

    if (n < min) {
      throw new OutOfBoundError(`Expected ${n} >= ${min}`);
    }
    if (n > max) {
      throw new OutOfBoundError(`Expected ${n} <= ${max}`);
    }

    values[n] = 1;
  }

  public constructor(options: CronOptions) {
    this.options = options;

    // Resolve alias or use raw expression
    const expr = this.resolveAlias(options.schedule);
    const tokens = new Scanner(expr).scan();

    const fields = expr.trim().split(/\s+/);
    this.hasSeconds = fields.length === FieldAmount.max;

    // Parse and validate the cron expression
    this.parse(tokens);
  }

  // Map alias to standard cron expression if present
  private resolveAlias(schedule: string) {
    return ALIASES[schedule] || schedule;
  }

  private parse(tokens: Token[]) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (!token) {
        throw new InvalidValueError("Undefined token");
      }

      const tokenType = token.getTokenType();

      switch (token.getField()) {
        case "second": {
          this.handleField(
            token,
            this.second,
            CronSecondRange.min,
            CronSecondRange.max,
          );

          break;
        }
        case "minute": {
          this.handleField(
            token,
            this.minute,
            CronMinuteRange.min,
            CronMinuteRange.max,
          );

          break;
        }
        case "hour": {
          this.handleField(
            token,
            this.hour,
            CronHourRange.min,
            CronHourRange.max,
          );

          break;
        }
        case "day": {
          if (tokenType === "any") {
            this._dayWildcard = true;
          }

          this.handleField(token, this.day, CronDayRange.min, CronDayRange.max);

          break;
        }
        case "month": {
          this.handleField(
            token,
            this.month,
            CronMonthRange.min,
            CronMonthRange.max,
          );

          break;
        }
        case "weekday": {
          if (tokenType === "any") {
            this._dowWildcard = true;
          }

          this.handleField(
            token,
            this.dayOfWeek,
            CronDayOfWeekRange.min,
            CronDayOfWeekRange.max,
          );

          break;
        }
        default:
          throw new InvalidValueError(`Invalid field '${token.getField()}'`);
      }
    }
  }

  private handleField(token: Token, field: number[], min: number, max: number) {
    switch (token.getTokenType()) {
      case "any": {
        this.fillRange(field, min, max);
        break;
      }
      case "number": {
        this.handleNumber(token.getComponent(), field, min, max);

        break;
      }
      case "range": {
        const component = token.getComponent();
        this.handleRange(component, field, min, max);

        break;
      }
      case "step": {
        const component = token.getComponent();
        this.handleStep(component, field, min, max);

        break;
      }
      default:
        throw new InvalidValueError(
          `Invalid token type '${token.getTokenType()}'`,
        );
    }
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
    const isMonthMatch = this.month[mon + 1] === 1;

    // Standard cron: when both day-of-month and day-of-week are restricted (not *),
    // fire if EITHER matches. When at least one is *, use AND (the wildcard is always 1).
    let isDayOrDowMatch: boolean;

    if (!this._dayWildcard && !this._dowWildcard) {
      isDayOrDowMatch = this.day[d] === 1 || this.dayOfWeek[dow] === 1;
    } else {
      isDayOrDowMatch = this.day[d] === 1 && this.dayOfWeek[dow] === 1;
    }

    return (
      isSecondMatch &&
      isMinuteMatch &&
      isHourMatch &&
      isDayOrDowMatch &&
      isMonthMatch
    );
  }

  public getNextRun() {
    const date = new Date();

    // Start from next minute/second
    if (this.hasSeconds) {
      date.setMilliseconds(0);
      date.setSeconds(date.getSeconds() + 1);
    } else {
      date.setSeconds(0, 0);
      date.setMinutes(date.getMinutes() + 1);
    }

    // Search up to 4 years to cover leap-day schedules (next Feb 29 can be ~4 years away)
    const deadline = new Date(date);
    deadline.setFullYear(deadline.getFullYear() + MAX_YEARS);

    while (date < deadline) {
      const s = date.getSeconds();
      const m = date.getMinutes();
      const h = date.getHours();
      const d = date.getDate();
      const mon = date.getMonth();
      const dow = date.getDay();

      if (this.month[mon + 1] === 0) {
        date.setDate(1);
        date.setMonth(mon + 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }

      let isDayOrDowMatch: boolean;
      if (!this._dayWildcard && !this._dowWildcard) {
        isDayOrDowMatch = this.day[d] === 0 && this.dayOfWeek[dow] === 0;
      } else {
        isDayOrDowMatch = this.day[d] === 0 || this.dayOfWeek[dow] === 0;
      }

      if (isDayOrDowMatch) {
        date.setDate(d + 1);
        date.setHours(0, 0, 0, 0);
        continue;
      }

      if (this.hour[h] === 0) {
        date.setHours(h + 1);
        date.setMinutes(0, 0, 0);
        continue;
      }

      if (this.minute[m] === 0) {
        date.setMinutes(m + 1);
        date.setSeconds(0, 0);
        continue;
      }

      if (this.hasSeconds && this.second[s] === 0) {
        date.setSeconds(s + 1);
        date.setMilliseconds(0);
        continue;
      }

      return new Date(date);
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
