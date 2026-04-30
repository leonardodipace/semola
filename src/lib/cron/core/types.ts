export type CronAlias =
  | "@yearly"
  | "@monthly"
  | "@weekly"
  | "@daily"
  | "@hourly"
  | "@minutely";

export type CronStatus = "idle" | "running" | "paused";

export type CronScannerError =
  | "EmptyCronExpressionError"
  | "CronLengthError"
  | "CronExpressionError";

export type CronParsingError = "InvalidValueError" | "OutOfBoundError";

export type CronOptions = {
  name: string;
  schedule: CronAlias | (string & {});
  handler: () => void | Promise<void>;
};
