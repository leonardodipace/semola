type MinutelyAlias = "@minutely";

export type ErrorMetadataType = {
  name: string;
  failedAt: number;
  error: Error;
};

export type ScheduleType =
  | Bun.CronWithAutocomplete
  | MinutelyAlias
  | (string & {});

export type CronOptions = {
  name: string;
  schedule: ScheduleType;
  handler: () => Promise<unknown>;
  onError?: (error: ErrorMetadataType) => void;
};

export type CronStatus = "idle" | "running";
