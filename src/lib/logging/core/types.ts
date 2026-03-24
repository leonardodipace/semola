export const LogLevel = {
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
  critical: 50,
} as const;

export type LogLevelType = keyof typeof LogLevel;

export type LogMessageType = string | object | number | boolean;

export type LogDataType = {
  prefix: string;
  level: LogLevelType;
  msg: LogMessageType;
  row?: string;
  column?: string;
  fileName?: string;
  method?: string;
};
