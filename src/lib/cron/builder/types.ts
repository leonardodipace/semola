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

type CronPropertyType<Type> =
  | Type
  | CronRange<Type>
  | CronStep<Type>
  | CronList<Type>
  | CronAny;

export type CronJobBuilderOptions = {
  second: CronPropertyType<TimeType>;
  minute: CronPropertyType<TimeType>;
  hour: CronPropertyType<HourType>;
  day: CronPropertyType<DayType>;
  month: CronPropertyType<MonthType>;
  weekday: CronPropertyType<WeekDayType>;
};

export type CronRange<T> = { min: T; max: T };
export type CronStep<T> = { step: T; min?: T; max?: T };
export type CronList<T> = (T | CronRange<T> | CronStep<T>)[];
export type CronAny = { wildcard: "*" };
