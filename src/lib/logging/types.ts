import type { Formatter } from "./formatter.js";

export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warning = 30,
  Error = 40,
  Critical = 50,
}

export type LogLevelType = keyof typeof LogLevel;

export type LogMessageType = string | object | number;

export type LogDataType = {
  prefix: string;
  level: LogLevelType;
  msg: LogMessageType;
};

export type ProviderOptions = {
  level?: LogLevel;
  formatter?: Formatter;
};
