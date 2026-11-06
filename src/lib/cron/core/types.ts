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

// Any Redis client that can send a raw command (Bun.RedisClient works as-is).
export type RedisClient = {
  send(command: string, args: string[]): Promise<unknown>;
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
