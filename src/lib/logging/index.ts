import { appendFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { mightThrowSync } from "../errors/index.js";
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
const NON_ERROR_CALL_STACK_IDX = 3;

const DurationUnit = {
  hour: 1000 * 60 * 60,
  day: 1000 * 60 * 60 * 24,
  week: 1000 * 60 * 60 * 24 * 7,
  month: 1000 * 60 * 60 * 24 * 7 * 4.345, // On average a 1 month has 4,345 weeks
} as const;

type StackTraceData = {
  fileName: string | null;
  column: number | null;
  row: number | null;
  functionCall: string | null;
};

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

function readStackData() {
  const error = new Error();
  const { stack } = error;

  if (!Array.isArray(stack)) return [] as StackTraceData[];

  return stack as StackTraceData[];
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
    const stack = readStackData();
    const logCall = stack[NON_ERROR_CALL_STACK_IDX];
    let logData: LogDataType = { level, msg, prefix };

    if (!logCall) {
      return logData;
    }

    const { column, fileName, functionCall, row } = logCall;

    if (fileName) {
      logData = { ...logData, fileName };
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
    this.options = options;

    if (!this.options.formatter) {
      this.options.formatter = PROVIDER_OPTION_DEFAULT.formatter;
    }

    if (!this.options.level) {
      this.options.level = PROVIDER_OPTION_DEFAULT.level;
    }
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
    if (Object.entries(options).length === 0) {
      super({
        formatter: FILE_PROVIDER_OPTION_DEFAULT.formatter,
        level: FILE_PROVIDER_OPTION_DEFAULT.level,
      });
      this.policy = FILE_PROVIDER_OPTION_DEFAULT.policy;
    } else {
      super({ formatter: options.formatter, level: options.level });
    }

    if (!options.policy) {
      this.policy = FILE_PROVIDER_OPTION_DEFAULT.policy;
    } else {
      this.policy = options.policy;
    }

    this.filePath = file;
    this.counter = 0;
    this.file = this.createNewFileName();
  }

  public execute(data: LogDataType): void {
    const level = this.getLogLevel();
    const userLevel = LogLevel[data.level];
    if (level > userLevel) return;

    let { msg } = data;
    const [error, _] = mightThrowSync(() => {
      const { formatter } = this.options;
      if (formatter) {
        msg = formatter.format(data);
      } else if (this.isJSONFile()) {
        msg = JSON.stringify({ message: msg });
      }
    });

    if (error && error instanceof Error) {
      const { formatter } = this.options;
      if (formatter) {
        const errorMsg = formatter.formatError(data, error);
        appendFileSync(this.file, `${errorMsg}\n`);
      } else {
        appendFileSync(this.file, `${error}\n`);
      }
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
    const [error, _] = mightThrowSync(() => {
      const { formatter } = this.options;
      if (formatter) {
        msg = formatter.format(data);
      } else if (typeof msg === "object") {
        msg = JSON.stringify(msg);
      }
    });

    // biome-ignore-start lint/suspicious/noConsole: function used for the correct
    // functionality of the logger
    if (error && error instanceof Error) {
      const { formatter } = this.options;
      if (formatter) {
        console.error(formatter.formatError(data, error));
      } else {
        console.error(error);
      }

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
