import type { Formatter } from "./formatter.js";

export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warning = 30,
  Error = 40,
  Critical = 50,
}

export type LogLevelType = keyof typeof LogLevel;

export type LogMessageType = string | object | number | boolean;

export type DateFmtFnType = () => string;

export type LogDataType = {
  prefix: string;
  level: LogLevelType;
  msg: LogMessageType;
  fileName: string;
  row: string;
  column: string;
  method?: string;
};

export type ProviderOptions = {
  level?: LogLevel;
  formatter?: Formatter;
};

export interface SizeBasedPolicyType {
  type: "size";
  maxSize?: number;
}

export interface TimeBasedPolicyType {
  type: "time";
  instant: "hour" | "day" | "week" | "month";
  duration: number;
}

export type FileProviderOptions = ProviderOptions & {
  policy?: SizeBasedPolicyType | TimeBasedPolicyType;
};
