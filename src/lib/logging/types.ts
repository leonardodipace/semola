export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARNING = 30,
  ERROR = 40,
  CRITICAL = 50,
}

export type LogLevelType = keyof typeof LogLevel;

export type LogDataType = {
  prefix: string;
  level: LogLevelType;
  msg: string;
};

export type LoggingOptions = {
  prefix: string;
  level?: LogLevel;
};
