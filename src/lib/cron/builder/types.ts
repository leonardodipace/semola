export const WeekDay = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
} as const;

export const Month = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
} as const;

type Enumerate<
  N extends number,
  Acc extends number[] = [],
> = Acc["length"] extends N
  ? Acc[number]
  : Enumerate<N, [...Acc, Acc["length"]]>;

type IntRange<F extends number, T extends number> = Exclude<
  Enumerate<T>,
  Enumerate<F>
>;

export type TimeType = IntRange<0, 60>; // 0–59
export type HourType = IntRange<0, 24>; // 0–23
export type DayType = IntRange<1, 32>; // 1–31
export type MonthType = IntRange<1, 13>; // 1–12
export type WeekDayType = IntRange<0, 7>; // 0–6

export type CronRange<T> = { min: NoInfer<T>; max: NoInfer<T> };
export type CronStep<T> = {
  step: NoInfer<T>;
  range?: { min: NoInfer<T>; max?: NoInfer<T> };
};

export type CronField =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "month"
  | "weekday";

export type CronListExpr<T> = Exclude<CronExpr<T>, { type: "list" }>;

export type CronExpr<T> =
  | { type: "any" }
  | { type: "value"; value: T }
  | { type: "range"; min: T; max: T }
  | { type: "step"; step: T; range?: { min: T; max?: T } }
  | { type: "list"; values: CronListExpr<T>[] };

interface IBuilder<Used extends CronField> {
  second(expr: CronExpr<TimeType>): CronBuilderType<Used | "second">;
  minute(expr: CronExpr<TimeType>): CronBuilderType<Used | "minute">;
  hour(expr: CronExpr<HourType>): CronBuilderType<Used | "hour">;
  day(expr: CronExpr<DayType>): CronBuilderType<Used | "day">;
  month(expr: CronExpr<MonthType>): CronBuilderType<Used | "month">;
  weekday(expr: CronExpr<WeekDayType>): CronBuilderType<Used | "weekday">;
}

export type CronBuilderType<Used extends CronField = never> = Omit<
  IBuilder<Used>,
  Used
>;

export type BuilderFn = (builder: CronBuilderType) => void;
