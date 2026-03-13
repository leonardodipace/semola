import type { Formatter } from "./formatter.js";

export const LogLevel = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  critical: 50,
} as const;

export type LogLevelType = keyof typeof LogLevel;

export type LogMessageType = string | object | number | boolean;

export type DateFmtFnType = () => string;

export type LogDataType = {
  prefix: string;
  level: LogLevelType;
  msg: LogMessageType;
  row?: string;
  column?: string;
  fileName?: string;
  method?: string;
};

export type ProviderOptions = {
  level?: LogLevelType;
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
