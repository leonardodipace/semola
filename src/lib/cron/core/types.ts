import type { RedisClient } from "../../redis/types.js";

export type ScheduleType =
  | "@yearly"
  | "@annually"
  | "@monthly"
  | "@weekly"
  | "@daily"
  | "@midnight"
  | "@hourly"
  | "@minutely"
  | (string & {});

export type CronBaseOptions = {
  name: string;
  schedule: ScheduleType;
};

export type CronOptions = CronBaseOptions & {
  handler: () => unknown;
};

export type CronOSOptions = CronBaseOptions & {
  path: string;
};

export type CronDistributedOptions = CronOptions & {
  redis: RedisClient;
  lockTTL?: number;
  replicaId?: string;
};

export type CronStatus = "idle" | "running";

export type CronTimer = ReturnType<typeof setTimeout>;

export type CronFieldSpec = {
  min: number;
  max: number;
  names?: readonly string[];
};

export type CronFields = {
  minutes: number[];
  hours: number[];
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  // POSIX: when both day-of-month and weekday are restricted, either one matches.
  matchEitherDay: boolean;
};

export interface CronUtilitiesInterface {
  getExpression(): string;
  getJobName(): string;
  next(from?: Date | number): Date | null;
}
