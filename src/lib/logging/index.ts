import { appendFileSync, statSync, existsSync } from "node:fs";
import type { Formatter } from "./formatter.js";
import { basename, dirname, join } from "node:path"

import {
  FileProviderOptions,
  type LogDataType,
  LogLevel,
  type LogLevelType,
  type LogMessageType,
  type ProviderOptions,
} from "./types.js";


const PROVIDER_OPTION_DEFAULT: ProviderOptions = {
  formatter: undefined,
  level: LogLevel.Debug
} as const

const DEFAULT_MAX_SIZE: number = 4 * 1024 // 4KB



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

  NON_ERROR_CALL_STACK_IDX = 4 as const;

  protected createLogData(
    level: LogLevelType,
    msg: LogMessageType,
    prefix: string,
  ): LogDataType {
    const stack = new StackData().getStack().split("\n")
    const logCall = stack[this.NON_ERROR_CALL_STACK_IDX] || "";

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

  public constructor(options: ProviderOptions = PROVIDER_OPTION_DEFAULT) {
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
  private readonly filePath: string;

  private maxSize: number = DEFAULT_MAX_SIZE;
  private counter: number;
  private file: string;

  public constructor(file: string, options?: FileProviderOptions) {
    super({ formatter: options?.formatter, level: options?.level });

    this.filePath = file;
    this.counter = 0;
    this.file = this.createNewFileName();
  }

  public execute(data: LogDataType): void {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return;

    let { msg } = data;
    if (this.options.formatter) {
      msg = this.options.formatter.format(data);
    } else if (this.isJSONFile()) {
      msg = JSON.stringify({ message: msg });
    }

    if (this.getFileSize() <= this.maxSize) {
      appendFileSync(this.file, `${msg}\n`);
    } else {
      this.counter += 1;
      this.file = this.createNewFileName();
    }
  }

  private getFileSize() {
    if (!existsSync(this.file)) {
      return 0;
    }

    const { size } = statSync(this.file);
    return size;
  }

  private isJSONFile() {
    const fileName = basename(this.filePath);
    const fileObj = Bun.file(fileName);
    const { type } = fileObj

    return type.includes("application/json")
  }

  private createNewFileName() {
    const fileName = basename(this.filePath);
    const directory = dirname(this.filePath);
    const fileInfo = fileName.split('.');
    const newFileName = `${fileInfo[0]}.${this.counter}.${fileInfo[1]}`

    return join(directory, newFileName);
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
