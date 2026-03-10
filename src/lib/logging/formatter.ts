import type { DateFmtFnType, LogDataType } from "./types.js";

export abstract class Formatter {
  protected dateFmt: DateFmtFnType;

  public constructor(dateFmt: DateFmtFnType) {
    this.dateFmt = dateFmt;
  }

  public abstract format(logData: LogDataType): string;
  public abstract formatError(logData: LogDataType, error: Error): string;
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

    const fileData = `${prefix}/${fileName}:${row}:${column}`;
    let header = `[${levelType}]`;

    if (method) {
      header = `${header}\t[${method}]\t[${fileData}]`;
    } else {
      header = `${header}\t[${fileData}]`;
    }

    return `${timestamp}  ${header} : ${msg}`;
  }

  public formatError(logData: LogDataType, error: Error): string {
    let { prefix, fileName, row, column, method } = logData;
    const timestamp = this.dateFmt();

    const fileData = `${prefix}/${fileName}:${row}:${column}`;
    let errorMsg = `Error name="${error.name}" Error message="${error.message}"`;
    let header = "[ERROR]";

    if (method) {
      header = `${header}\t[${method}]\t[${fileData}]`;
    } else {
      header = `${header}\t[${fileData}]`;
    }

    if (error.cause) {
      errorMsg = `${errorMsg}\n\tError cause="${error.cause}"`;
    }

    if (error.stack) {
      errorMsg = `${errorMsg}\n\tStack trace="${error.stack}"`;
    }

    return `${timestamp}  ${header} : ${errorMsg}`;
  }
}

export class JSONFormatter extends Formatter {
  public constructor(dateFmt: DateFmtFnType = isoDateTimeFormat) {
    super(dateFmt);
  }

  public format(logData: LogDataType): string {
    const { prefix, level, msg, fileName, row, column, method } = logData;
    const timestamp = this.dateFmt();
    const levelType = level.toUpperCase();

    let position: Record<string, string | undefined> = {};

    if (method) {
      position = { method };
    }

    position = { ...position, fileName, row, column };

    const data = {
      timestamp,
      level: levelType,
      prefix,
      position,
      msg,
    };

    return JSON.stringify(data);
  }

  public formatError(logData: LogDataType, error: Error): string {
    let { prefix, fileName, row, column, method } = logData;
    const timestamp = this.dateFmt();
    let errorMsg: Record<string, unknown> = {
      errorName: error.name,
      errorMessage: error.message,
    };
    let position: Record<string, string | undefined> = {};

    if (method) {
      position = { method };
    }

    position = { ...position, fileName, row, column };

    if (error.cause) {
      errorMsg = { ...errorMsg, errorCause: error.cause };
    }

    if (error.stack) {
      errorMsg = { ...errorMsg, stackTrace: error.stack };
    }

    const data = {
      timestamp,
      level: "ERROR",
      prefix,
      position,
      msg: errorMsg,
    };

    return JSON.stringify(data);
  }
}

export function isoDateTimeFormat() {
  return new Date().toISOString();
}

export function isoDateFormat() {
  const date = isoDateTimeFormat().split("T")[0];
  if (!date) return "";

  return date;
}

export function dmyFormat() {
  const isoDate = isoDateFormat();
  if (!isoDate) return "";

  const info = isoDate.split("-");

  return `${info[2]}-${info[1]}-${info[0]}`;
}

export function mdyFormat() {
  const isoDate = isoDateFormat();
  if (!isoDate) return "";

  const info = isoDate.split("-");

  return `${info[1]}-${info[2]}-${info[0]}`;
}
