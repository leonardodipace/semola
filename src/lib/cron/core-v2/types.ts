type MinutelyAlias = "@minutely";

export type ErrorMetadataType = {
  name: string;
  failedAt: number;
  error: Error;
};

export type CronOptions = {
  name: string;
  schedule: Bun.CronWithAutocomplete | MinutelyAlias | (string & {});
  handler: () => Promise<unknown>;
  onError?: (error: ErrorMetadataType) => void;
};

export type CronStatus = "idle" | "running";
