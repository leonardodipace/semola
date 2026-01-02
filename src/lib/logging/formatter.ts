import type { LogDataType } from "./types.js";

export abstract class Formatter<Input = LogDataType, Output = string> {
  protected dateFmt: () => string;

  public constructor(dateFmt: () => string) {
    this.dateFmt = dateFmt;
  }

  public abstract format(logData: Input): Output;
}

export class BaseFormatter extends Formatter {
  public constructor(dateFmt: () => string = isoDateTimeFormat) {
    super(dateFmt);
  }

  public format(logData: LogDataType): string {
    const { prefix, level, msg } = logData;
    const timestamp = this.dateFmt();

    return `${timestamp}  [${level}]\t[${prefix}] : ${msg}`;
  }
}

export class JSONFormatter extends Formatter {
  public constructor(dateFmt: () => string = isoDateTimeFormat) {
    super(dateFmt);
  }

  public format(logData: LogDataType): string {
    const data = {
      timestamp: this.dateFmt(),
      ...logData,
    };
    return JSON.stringify(data);
  }
}

export function isoDateTimeFormat() {
  return new Date().toISOString();
}

export function isoDateFormat() {
  const date = new Date();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();

  return `${year}-${month}-${day}`;
}

export function dmyFormat() {
  const date = new Date();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();

  return `${day}-${month}-${year}`;
}

export function mdyFormat() {
  const date = new Date();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();

  return `${month}-${day}-${year}`;
}
