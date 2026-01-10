import type { DateFmtFnType, LogDataType } from "./types.js";

export abstract class Formatter<Input = LogDataType, Output = string> {
  protected dateFmt: DateFmtFnType;

  public constructor(dateFmt: DateFmtFnType) {
    this.dateFmt = dateFmt;
  }

  public abstract format(logData: Input): Output;
}

export class BaseFormatter extends Formatter {
  public constructor(dateFmt: DateFmtFnType = isoDateTimeFormat) {
    super(dateFmt);
  }

  public format(logData: LogDataType): string {
    let { prefix, level, msg, fileName, row, column, method } = logData;
    const timestamp = this.dateFmt();
    const levelType = level.toUpperCase();
    if (typeof msg === "object") {
      msg = JSON.stringify(msg);
    }


    const fileData = `${prefix}/${fileName}:${row}:${column}`
    let header = `[${levelType}]`

    if (method) {
      header = `${header}\t[${method}]\t[${fileData}]`
    } else {
      header = `${header}\t[${fileData}]`
    }

    return `${timestamp}  ${header} : ${msg}`;
  }
}

export class JSONFormatter extends Formatter {
  public constructor(dateFmt: DateFmtFnType = isoDateTimeFormat) {
    super(dateFmt);
  }

  public format(logData: LogDataType): string {
    let { prefix, level, msg, fileName, row, column, method } = logData;
    const timestamp = this.dateFmt();
    const levelType = level.toUpperCase();

    let position: Record<string, string | undefined> = {}

    if (method) {
      position = { method };
    }

    position = { ...position, fileName, row, column }

    const data = {
      timestamp,
      level: levelType,
      prefix,
      position,
      msg
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
