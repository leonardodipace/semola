import type {
  BuilderFn,
  CronBuilderType,
  CronExpr,
  CronField,
  CronListExpr,
  CronRange,
  CronStep,
  DayType,
  HourType,
  MonthType,
  TimeType,
  WeekDayType,
} from "./types.js";

const CRON_FIELD_ORDER: CronField[] = [
  "second",
  "minute",
  "hour",
  "day",
  "month",
  "weekday",
] as const;

class FieldWrapper<T> {
  private fields: CronListExpr<T>[] = [];

  public add(expr: CronListExpr<T>) {
    this.fields.push(expr);
  }

  public read() {
    return this.fields;
  }
}

class CronListBuilder<T> {
  private wrapper: FieldWrapper<T>;

  public constructor(wrapper: FieldWrapper<T>) {
    this.wrapper = wrapper;
  }

  public any(): CronListBuilder<T> {
    this.wrapper.add({ type: "any" });
    return this;
  }

  public range(options: CronRange<T>): CronListBuilder<T> {
    this.wrapper.add({ type: "range", ...options });
    return this;
  }

  public step(options: CronStep<T>): CronListBuilder<T> {
    this.wrapper.add({ type: "step", ...options });
    return this;
  }

  public number(value: T): CronListBuilder<T> {
    this.wrapper.add({ type: "value", value: value });
    return this;
  }
}

export function range<T>(options: CronRange<T>): CronExpr<T> {
  return { type: "range", ...options };
}

export function any<T>(): CronExpr<T> {
  return { type: "any" };
}

export function step<T>(options: CronStep<T>): CronExpr<T> {
  return { type: "step", ...options };
}

export function list<T>(
  builderFn: (builder: CronListBuilder<T>) => CronListBuilder<T>,
): CronExpr<T> {
  const wrapper = new FieldWrapper<T>();
  builderFn(new CronListBuilder<T>(wrapper));

  return { type: "list", values: wrapper.read() };
}

export function number<T>(value: T) {
  return { type: "value", value: value } satisfies CronExpr<T>;
}

export function cronJobBuilder(buildFn: BuilderFn) {
  const fields: Partial<Record<CronField, string>> = {
    second: undefined,
    minute: undefined,
    hour: undefined,
    day: undefined,
    month: undefined,
    weekday: undefined,
  };

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

  buildFn(obj);
  return generate(fields);
}

function checkExpr<T>(expr: CronExpr<T>) {
  if (expr.type === "list") {
    const { values } = expr;
    if (values.length === 0) {
      throw new Error("EmptyListError: List expression cannot be empty");
    }

    const data = values.map((e) => handleSimpleExpression(e));

    return data.join(",");
  }

  return handleSimpleExpression(expr);
}

function handleSimpleExpression<T>(expr: CronExpr<T>) {
  switch (expr.type) {
    case "any": {
      return "*";
    }

    case "value": {
      return `${expr.value}`;
    }

    case "range": {
      const { min, max } = expr;
      if (min > max) {
        throw new Error(`OutOfBoundError: Expected ${min} <= ${max}`);
      }

      return `${expr.min}-${expr.max}`;
    }

    case "step": {
      const { step, range } = expr;

      if (step === 0) {
        throw new Error(
          `OutOfBoundError: Expected step value greater than zero`,
        );
      }

      if (!range) {
        return `*/${step}`;
      }

      const { min, max } = range;

      if (max === 0) {
        if (min > max) {
          throw new Error(
            `OutOfBoundError: Expected max value greater than zero`,
          );
        }

        return `${min}-${max}/${step}`;
      }

      if (!max) {
        return `${min}/${step}`;
      }

      if (min > max) {
        throw new Error(`OutOfBoundError: Expected ${min} <= ${max}`);
      }

      return `${min}-${max}/${step}`;
    }

    default: {
      return "*";
    }
  }
}

function generate(fields: Partial<Record<CronField, string>>): string {
  const parts: string[] = [];

  for (let index = 0; index < CRON_FIELD_ORDER.length; index++) {
    const key = CRON_FIELD_ORDER[index];
    if (!key) return "";
    if (key === "second" && !fields[key]) {
      continue;
    }

    parts.push(fields[key] ?? "*");
  }

  return parts.join(" ");
}
