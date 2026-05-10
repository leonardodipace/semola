type MinutelyAlias = "@minutely";

export type CronOptions = {
  name: string;
  schedule: Bun.CronWithAutocomplete | MinutelyAlias | (string & {});
  handler: () => Promise<unknown>;
  onError?: () => void;
};

export type CronStatus = "idle" | "running";
