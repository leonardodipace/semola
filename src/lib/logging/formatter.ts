import type { LogDataType } from "./types.js";

export interface Formatter<Input = LogDataType, Output = string> {
  format(logData: Input): Output;
}

export class BaseFormatter implements Formatter {
  public format(logData: LogDataType): string {
    const { prefix, level, msg } = logData;
    const timestamp = new Date().toISOString();

    return `${timestamp}  [${level}]\t[${prefix}] : ${msg}`;
  }
}

export class SimpleJSONFormatter implements Formatter {
  public format(logData: LogDataType): string {
    const data = {
      timestamp: new Date().toISOString(),
      ...logData,
    };
    return JSON.stringify(data);
  }
}
