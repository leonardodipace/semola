export type CronAlias =
  | "@yearly"
  | "@monthly"
  | "@weekly"
  | "@daily"
  | "@hourly"
  | "@minutely";

export type CronStatus = "idle" | "running" | "paused";

export type CronOptions = {
  name: string;
  schedule: CronAlias | (string & {});
  handler: () => void | Promise<void>;
};
