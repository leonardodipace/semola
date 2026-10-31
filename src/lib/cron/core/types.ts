type MinutelyAlias = "@minutely";

export type ScheduleType = Bun.CronWithAutocomplete | MinutelyAlias;

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

export type RedisClient = {
  set: (
    key: string,
    value: string,
    ...args: (string | number)[]
  ) => Promise<"OK" | string | null | undefined>;
};

export type CronDistributedOptions = CronOptions & {
  redis: RedisClient;
  lockTTL?: number;
  replicaId?: string;
};

export type CronStatus = "idle" | "running";

export interface CronUtilitiesInterface {
  getExpression(): string;
  getJobName(): string;
  next(from?: Date | number): Date | null;
}
