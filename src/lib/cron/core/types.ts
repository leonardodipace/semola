type MinutelyAlias = "@minutely";

export type ScheduleType = Bun.CronWithAutocomplete | MinutelyAlias;

export type CronBaseOptions = {
  name: string;
  schedule: ScheduleType;
};

export type CronOptions = CronBaseOptions & {
  handler: () => unknown;
  jobId?: string;
};

export type CronOSOptions = CronBaseOptions & {
  path: string;
};

export type CronStatus = "idle" | "running";

export interface CronUtilitiesInterface {
  getExpression(schedule: ScheduleType): string;
  getJobName(options: CronBaseOptions): string;
  next(from?: Date | number): Date | null;
}
