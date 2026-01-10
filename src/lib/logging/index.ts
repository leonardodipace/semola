import { appendFileSync } from "node:fs";
import type { Formatter } from "./formatter.js";
import { basename } from "node:path"

import {
  type LogDataType,
  LogLevel,
  type LogLevelType,
  type LogMessageType,
  type ProviderOptions,
} from "./types.js";

class StackData {
  private stack: string = "";

  constructor() {
    Error.captureStackTrace(this)
  }

  public getStack() {
    return this.stack;
  }
}

export abstract class AbstractLogger {
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
    const stack = new StackData().getStack().split("\n")
    const logCall = stack[4] || "";

    const [path, row, column] = logCall?.trim()
      .replace("(", "")
      .replace(")", "")
      .split(":")

    const fileName = basename(path || "")

    let methodCall = undefined;
    const pathData = path?.split(" ") || []

    if (pathData.length === 3) {
      methodCall = pathData[1]
    }

    return {
      level,
      msg,
      prefix,
      fileName,
      row: row ?? "",
      column: column ?? "",
      method: methodCall
    };
  }
}

export class Logger extends AbstractLogger {
  private providers: LoggerProvider[];
  private prefix: string;

  public constructor(prefix: string, providers: LoggerProvider[]) {
    super();
    this.prefix = prefix;
    this.providers = providers;
  }

  public debug(msg: LogMessageType) {
    const data = this.createLogData("Debug", msg, this.prefix);
    this.run(data);
  }

  public info(msg: LogMessageType) {
    const data = this.createLogData("Info", msg, this.prefix);
    this.run(data);
  }

  public warning(msg: LogMessageType) {
    const data = this.createLogData("Warning", msg, this.prefix);
    this.run(data);
  }

  public error(msg: LogMessageType) {
    const data = this.createLogData("Error", msg, this.prefix);
    this.run(data);
  }

  public critical(msg: LogMessageType) {
    const data = this.createLogData("Critical", msg, this.prefix);
    this.run(data);
  }

  private run(data: LogDataType) {
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      provider?.execute(data);
    }
  }
}

export abstract class LoggerProvider {
  protected options: ProviderOptions;

  public constructor(options: ProviderOptions) {
    this.options = options;
  }

  public abstract execute(data: LogDataType): void;

  public getLogLevel() {
    if (!this.options.level) {
      return LogLevel.Debug;
    }

    return this.options.level;
  }

  public setFormatter(formatter: Formatter) {
    this.options.formatter = formatter;
  }
}

export class FileProvider extends LoggerProvider {
  private file: string;

  public constructor(file: string, options: ProviderOptions) {
    super(options);
    this.file = file;
  }

  public execute(data: LogDataType): void {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return;

    let { msg } = data;
    if (this.options.formatter) {
      msg = this.options.formatter.format(data);
    } else if (typeof msg === "object") {
      msg = JSON.stringify(msg);
    }

    appendFileSync(this.file, `${msg}`);
    appendFileSync(this.file, "\n");
  }
}

export class ConsoleProvider extends LoggerProvider {
  public execute(data: LogDataType): void {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return;

    let { msg } = data;
    if (this.options.formatter) {
      msg = this.options.formatter.format(data);
    } else if (typeof msg === "object") {
      msg = JSON.stringify(msg);
    }

    // biome-ignore-start lint/suspicious/noConsole: function used for the correct
    // functionality of the logger
    switch (userLevel) {
      case LogLevel.Debug:
        console.debug(msg);
        break;
      case LogLevel.Info:
        console.info(msg);
        break;
      case LogLevel.Warning:
        console.warn(msg);
        break;
      case LogLevel.Error:
        console.error(msg);
        break;
      case LogLevel.Critical:
        console.error(msg);
        break;
      default:
        console.debug(msg);
        break;
    }
    // biome-ignore-end lint/suspicious/noConsole: function used for the correct
    // functionality of the logger
  }
}
