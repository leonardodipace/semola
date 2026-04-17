import type {
  BuilderFn,
  CronBuilderType,
  CronExpr,
  CronField,
  CronListElements,
  CronRange,
  CronStep,
  DayType,
  HourType,
  MonthType,
  TimeType,
  WeekDayType,
} from "./types.js";

export function range<T>(options: CronRange<T>) {
  return { type: "range", ...options } satisfies CronExpr<T>;
}

export function any<T>() {
  return { type: "any" } satisfies CronExpr<T>;
}

export function step<T>(options: CronStep<T>) {
  return { type: "step", ...options } satisfies CronExpr<T>;
}

export function list<T>(elements: CronListElements<T>[]) {
  throw new Error("TODO: Implement this function");
}

export function number<T>(value: T) {
  return { type: "value", value: value } satisfies CronExpr<T>;
}

export function cronJobBuilder(buildFn: BuilderFn) {
  const fields: Partial<Record<CronField, string>> = {};
  const obj: CronBuilderType = {
    second(expr: CronExpr<TimeType>) {
      fields.second = checkExpr(expr);
      return obj;
    },
    minute(expr: CronExpr<TimeType>) {
      fields.minute = checkExpr(expr);

      return obj;
    },
    hour(expr: CronExpr<HourType>) {
      fields.hour = checkExpr(expr);
      return obj;
    },
    day(expr: CronExpr<DayType>) {
      fields.day = checkExpr(expr);
      return obj;
    },
    month(expr: CronExpr<MonthType>) {
      fields.month = checkExpr(expr);
      return obj;
    },
    weekday(expr: CronExpr<WeekDayType>) {
      fields.weekday = checkExpr(expr);
      return obj;
    },
  };

  const builder = buildFn(obj);
  return generate(builder);
}

function checkExpr<T>(expr: CronExpr<T>) {
  switch (expr.type) {
    case "any":
      return "*";

    case "value":
      return `${expr.value}`;

    case "range": {
      const { min, max } = expr;
      if (min > max) {
        throw new Error(`OutOfBoundError: Expected ${min} <= ${max}`);
      }

      return `${expr.min}-${expr.max}`;
    }

    case "step": {
      const { step, range } = expr;

      if (!range) {
        return `*/${step}`;
      }

      const { min, max } = range;

      if (!max) {
        return `${min}/${step}`;
      }

      if (max) {
        if (min > max) {
          throw new Error(`OutOfBoundError: Expected ${min} <= ${max}`);
        }
      }

      return `${min}-${max}/${step}`;
    }

    case "list": {
      return "";
    }
    default:
      return "*";
  }
}

function generate(builderObj: Omit<CronBuilderType<never>, CronField>): string {
  throw new Error("TODO: Implement");
}
