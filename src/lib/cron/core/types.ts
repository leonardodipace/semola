import type { RedisClient } from "../../redis/types.js";

export type CronBaseOptions = {
  name: string;
  schedule: string;
};

export type CronOptions = CronBaseOptions & {
  handler: (scheduledAt: Date) => unknown;
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

export type CronFieldSpec = {
  min: number;
  max: number;
  names?: readonly string[];
};

export type CronFields = {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
  // POSIX: when both day-of-month and weekday are restricted, either one matches.
  matchEitherDay: boolean;
};

export interface CronUtilitiesInterface {
  getExpression(): string;
  getJobName(): string;
  next(from?: Date | number): Date | null;
}
