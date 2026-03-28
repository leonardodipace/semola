import { basename } from "node:path";
import { mightThrowSync } from "../../errors/index.js";
import { BaseFormatter } from "../formatter/index.js";
import type { LoggerProvider } from "../provider/index.js";
import type { ProviderOptions } from "../provider/types.js";
import type { LogDataType, LogLevelType, LogMessageType } from "./types.js";

export const PROVIDER_OPTION_DEFAULT: ProviderOptions = {
  formatter: new BaseFormatter(),
  level: "debug",
} as const;

const STACK_FRAME_IDX = 1;

export type StackTraceData = {
  fileName: string | null;
  column: number | null;
  row: number | null;
  functionCall: string | null;
};

export class StackData {
  private stack: StackTraceData[] = [];

  public constructor(fn: Function) {
    const oldStackTrace = Error.prepareStackTrace;
    const [stackTraceError] = mightThrowSync(() => {
      Error.prepareStackTrace = (_, stack) => {
        return stack.map<StackTraceData>((callSite) => {
          return {
            fileName: callSite.getFileName(),
            column: callSite.getColumnNumber(),
            row: callSite.getLineNumber(),
            functionCall: callSite.getFunctionName(),
          };
        });
      };

      Error.captureStackTrace(this, fn);
    });

    Error.prepareStackTrace = oldStackTrace;
    if (stackTraceError) this.stack = [];
  }

  public retrieveFrame() {
    if (this.stack.length === 0) return undefined;

    // Access the second stack frame because I need to ignore
    // a logging function's stack frame (e.g "debug()" and "info()")
    return this.stack[STACK_FRAME_IDX];
  }
}

export abstract class AbstractLogger {
  protected providers: LoggerProvider[];
  protected prefix: string;

  public constructor(
    prefix: string,
    providers: [LoggerProvider, ...LoggerProvider[]],
  ) {
    this.prefix = prefix;
    this.providers = providers;
  }

  public abstract debug(msg: LogMessageType): void;
  public abstract info(msg: LogMessageType): void;
  public abstract warning(msg: LogMessageType): void;
  public abstract error(msg: LogMessageType): void;
  public abstract critical(msg: LogMessageType): void;

  protected createLogData(
    level: LogLevelType,
    msg: LogMessageType,
    prefix: string,
  ): LogDataType {
    const stack = new StackData(this.createLogData);
    const logCall = stack.retrieveFrame();
    let logData: LogDataType = { level, msg, prefix };

    if (!logCall) {
      return logData;
    }

    const { column, fileName, functionCall, row } = logCall;

    if (fileName) {
      logData = { ...logData, fileName: basename(fileName) };
    }

    if (column) {
      logData = { ...logData, column: String(column) };
    }

    if (row) {
      logData = { ...logData, row: String(row) };
    }

    if (functionCall) {
      logData = { ...logData, method: functionCall };
    }

    return logData;
  }
}

export class Logger extends AbstractLogger {
  public debug(msg: LogMessageType) {
    const data = this.createLogData("debug", msg, this.prefix);
    this.run(data);
  }

  public info(msg: LogMessageType) {
    const data = this.createLogData("info", msg, this.prefix);
    this.run(data);
  }

  public warning(msg: LogMessageType) {
    const data = this.createLogData("warning", msg, this.prefix);
    this.run(data);
  }

  public error(msg: LogMessageType) {
    const data = this.createLogData("error", msg, this.prefix);
    this.run(data);
  }

  public critical(msg: LogMessageType) {
    const data = this.createLogData("critical", msg, this.prefix);
    this.run(data);
  }

  private run(data: LogDataType) {
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      provider?.execute(data);
    }
  }
}
