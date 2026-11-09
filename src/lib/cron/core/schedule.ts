import type { CronFieldSpec, CronFields } from "./types.js";

// The furthest gap between two matches is Feb 29 across a skipped leap year (2096 -> 2104).
const SEARCH_HORIZON_YEARS = 8;
const CRON_FIELD_COUNT = 5;
const WEEKDAYS_PER_WEEK = 7;

const WHITESPACE_PATTERN = /\s+/;
// Names are not steps: "*/mar" stays invalid.
const NAME_PATTERN = /(?<!\/)\b[a-z]+\b/gi;
const FIELD_PART_PATTERN = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/;

const MINUTE_SPEC: CronFieldSpec = { min: 0, max: 59 };
const HOUR_SPEC: CronFieldSpec = { min: 0, max: 23 };
const DAY_SPEC: CronFieldSpec = { min: 1, max: 31 };
const MONTH_SPEC: CronFieldSpec = {
  min: 1,
  max: 12,
  names:
    "january february march april may june july august september october november december".split(
      " ",
    ),
};
// 0 and 7 both mean Sunday.
const WEEKDAY_SPEC: CronFieldSpec = {
  min: 0,
  max: 7,
  names: "sunday monday tuesday wednesday thursday friday saturday".split(" "),
};

const invalidField = (text: string) => {
  return new TypeError(`Invalid cron field "${text}"`);
};

// "MON" or "monday" becomes its number. Unknown words stay letters, so the
// field pattern rejects them.
const nameToNumber = (word: string, spec: CronFieldSpec) => {
  const lower = word.toLowerCase();
  const index =
    spec.names?.findIndex(
      (name) => name === lower || name.slice(0, 3) === lower,
    ) ?? -1;

  if (index === -1) return word;

  return String(index + spec.min);
};

const parseField = (text: string, spec: CronFieldSpec) => {
  const values = new Set<number>();

  for (const part of text.split(",")) {
    const numeric = part.replace(NAME_PATTERN, (word) =>
      nameToNumber(word, spec),
    );
    const match = FIELD_PART_PATTERN.exec(numeric);

    if (!match) throw invalidField(text);

    const [, startText, endText, stepText] = match;
    const step = Number(stepText ?? 1);
    const start = Number(startText ?? spec.min);

    // "5" is one value, "5/15" runs from 5 to the field maximum.
    const isSingleValue =
      startText !== undefined &&
      endText === undefined &&
      stepText === undefined;

    let end = spec.max;
    if (endText !== undefined) end = Number(endText);
    if (isSingleValue) end = start;

    const isInBounds = start >= spec.min && start <= end && end <= spec.max;

    if (!isInBounds) throw invalidField(text);
    if (step < 1) throw invalidField(text);

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return [...values].sort((a, b) => a - b);
};

export const parseExpression = (expression: string) => {
  const parts = expression.trim().split(WHITESPACE_PATTERN);

  if (parts.length !== CRON_FIELD_COUNT) {
    throw new TypeError(
      `Invalid cron expression "${expression}": expected 5 fields (minute hour day month weekday)`,
    );
  }

  const [minute = "", hour = "", day = "", month = "", weekday = ""] = parts;
  const weekdays = parseField(weekday, WEEKDAY_SPEC);

  const fields: CronFields = {
    minutes: parseField(minute, MINUTE_SPEC),
    hours: parseField(hour, HOUR_SPEC),
    days: new Set(parseField(day, DAY_SPEC)),
    months: new Set(parseField(month, MONTH_SPEC)),
    weekdays: new Set(weekdays.map((value) => value % WEEKDAYS_PER_WEEK)),
    matchEitherDay: day !== "*" && weekday !== "*",
  };

  return fields;
};

const matchesDate = (fields: CronFields, date: Date) => {
  if (!fields.months.has(date.getMonth() + 1)) return false;

  const dayMatches = fields.days.has(date.getDate());
  const weekdayMatches = fields.weekdays.has(date.getDay());

  if (fields.matchEitherDay) return dayMatches || weekdayMatches;

  return dayMatches && weekdayMatches;
};

// Local time, like Bun.cron. Each candidate comes from the local Date
// constructor, so a fixed time inside a DST gap runs once, shifted forward, and
// in a repeated hour runs once, on its first pass.
export const nextRun = (fields: CronFields, from: Date | number) => {
  const start = new Date(from);

  if (Number.isNaN(start.getTime())) throw new TypeError("Invalid date value");

  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const lastYear = day.getFullYear() + SEARCH_HORIZON_YEARS;

  while (day.getFullYear() <= lastYear) {
    if (matchesDate(fields, day)) {
      for (const hour of fields.hours) {
        for (const minute of fields.minutes) {
          const candidate = new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            hour,
            minute,
          );

          if (candidate > start) return candidate;
        }
      }
    }

    day.setDate(day.getDate() + 1);
  }

  return null;
};
