import { appendFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { mightThrowSync } from "../../errors/index.js";
import { BaseFormatter } from "./formatter.js";
import {
  type FileProviderOptions,
  type LogDataType,
  LogLevel,
  type LogLevelType,
  type LogMessageType,
  type ProviderOptions,
  type SizeBasedPolicyType,
  type TimeBasedPolicyType,
} from "./types.js";

const PROVIDER_OPTION_DEFAULT: ProviderOptions = {
  formatter: new BaseFormatter(),
  level: "debug",
} as const;

const FILE_PROVIDER_OPTION_DEFAULT: FileProviderOptions = {
  ...PROVIDER_OPTION_DEFAULT,
  policy: { type: "size" },
} as const;

const DEFAULT_MAX_SIZE = 4 * 1024; // 4KB
const STACK_FRAME_IDX = 1;

const DurationUnit = {
  hour: 1000 * 60 * 60,
  day: 1000 * 60 * 60 * 24,
  week: 1000 * 60 * 60 * 24 * 7,
  month: 1000 * 60 * 60 * 24 * 7 * 4.345, // On average 1 month has 4,345 weeks
} as const;

type StackTraceData = {
  fileName: string | null;
  column: number | null;
  row: number | null;
  functionCall: string | null;
};

class StackData {
  private stack: StackTraceData[] = [] as StackTraceData[];

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

  public retriveFrame() {
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
    const logCall = stack.retriveFrame();
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

export abstract class LoggerProvider {
  protected options: ProviderOptions;

  public constructor(options: ProviderOptions = PROVIDER_OPTION_DEFAULT) {
    this.options = { ...PROVIDER_OPTION_DEFAULT, ...options };
  }

  public abstract execute(data: LogDataType): void;

  public getLogLevel(): number {
    if (!this.options.level) {
      return LogLevel.debug;
    }

    return LogLevel[this.options.level];
  }
}

export class FileProvider extends LoggerProvider {
  private readonly filePath: string;

  private counter: number;
  private file: string;
  private policy?: SizeBasedPolicyType | TimeBasedPolicyType;

  public constructor(
    file: string,
    options: FileProviderOptions = FILE_PROVIDER_OPTION_DEFAULT,
  ) {
    super({
      formatter: options.formatter ?? PROVIDER_OPTION_DEFAULT.formatter,
      level: options.level ?? PROVIDER_OPTION_DEFAULT.level,
    });
    this.policy = options.policy ?? FILE_PROVIDER_OPTION_DEFAULT.policy;

    this.filePath = file;
    this.counter = 0;
    this.file = this.createNewFileName();
  }

  public execute(data: LogDataType): void {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return;

    let { msg } = data;
    const [error] = mightThrowSync(() => {
      const { formatter } = this.options;
      msg = formatter?.format(data) ?? msg;

      if (this.isJSONFile()) {
        msg = JSON.stringify({ message: msg });
      }
    });

    if (error && error instanceof Error) {
      const { formatter } = this.options;
      const errorMsg = formatter?.formatError(data, error);
      appendFileSync(this.file, `${errorMsg}\n`);
    }

    if (this.canRollFile()) {
      this.counter += 1;
      this.file = this.createNewFileName();
    }

    if (error) return;
    appendFileSync(this.file, `${msg}\n`);
  }

  private canRollFile() {
    if (!this.policy) return false;

    switch (this.policy.type) {
      case "size": {
        if (this.policy.maxSize) {
          return this.getFileSize() >= this.policy.maxSize;
        }

        return this.getFileSize() >= DEFAULT_MAX_SIZE;
      }
      case "time": {
        if (!existsSync(this.file)) return false;

        const { duration, instant } = this.policy;
        const { birthtime } = statSync(this.file);
        const creationTimeMs = birthtime.getTime();
        const currenTimeMs = Date.now();
        const diffMs = currenTimeMs - creationTimeMs;

        switch (instant) {
          case "hour":
            return Math.floor(diffMs / DurationUnit.hour) >= duration;
          case "day":
            return Math.floor(diffMs / DurationUnit.day) >= duration;
          case "week":
            return Math.floor(diffMs / DurationUnit.week) >= duration;
          case "month":
            return Math.floor(diffMs / DurationUnit.month) >= duration;
        }
      }
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
    return extname(this.filePath) === ".json";
  }

  private createNewFileName() {
    const fileName = basename(this.filePath);
    const directory = dirname(this.filePath);
    const fileInfo = fileName.split(".");
    const extension = fileInfo.pop();
    const newFileName = [...fileInfo, this.counter, extension].join(".");

    return join(directory, newFileName);
  }
}

export class ConsoleProvider extends LoggerProvider {
  public execute(data: LogDataType): void {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return;

    let { msg } = data;
    const [error] = mightThrowSync(() => {
      const { formatter } = this.options;
      msg = formatter?.format(data) ?? msg;
    });

    // biome-ignore-start lint/suspicious/noConsole: function used for the correct
    // functionality of the logger
    if (error && error instanceof Error) {
      const { formatter } = this.options;
      console.error(formatter?.formatError(data, error));

      return;
    }

    switch (userLevel) {
      case LogLevel.debug:
        console.debug(msg);
        break;
      case LogLevel.info:
        console.info(msg);
        break;
      case LogLevel.warning:
        console.warn(msg);
        break;
      case LogLevel.error:
        console.error(msg);
        break;
      case LogLevel.critical:
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
