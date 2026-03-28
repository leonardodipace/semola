import { appendFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { mightThrowSync } from "../../errors/index.js";
import { PROVIDER_OPTION_DEFAULT } from "../core/index.js";

import { type LogDataType, LogLevel } from "../core/types.js";
import type {
  FileProviderOptions,
  ProviderOptions,
  SizeBasedPolicyType,
  TimeBasedPolicyType,
} from "./types.js";

const DEFAULT_MAX_SIZE = 4 * 1024; // 4KB

const DurationUnit = {
  hour: 1000 * 60 * 60,
  day: 1000 * 60 * 60 * 24,
  week: 1000 * 60 * 60 * 24 * 7,
  month: 1000 * 60 * 60 * 24 * 7 * 4.345, // On average 1 month has 4,345 weeks
} as const;

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

const FILE_PROVIDER_OPTION_DEFAULT: FileProviderOptions = {
  ...PROVIDER_OPTION_DEFAULT,
  policy: { type: "size" },
} as const;

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

    const [error, formattedMessage] = mightThrowSync(() => {
      if (this.isJSONFile()) {
        return JSON.stringify({ message: data.msg });
      }

      const { formatter } = this.options;
      return formatter?.format(data) ?? "";
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

    if (error || !formattedMessage) return;
    appendFileSync(this.file, `${formattedMessage}\n`);
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
          case "month": {
            const currentDate = new Date(currenTimeMs);
            const monthsDiff =
              (currentDate.getFullYear() - birthtime.getFullYear()) * 12 +
              (currentDate.getMonth() - birthtime.getMonth());

            const adjustedDiff =
              currentDate.getDate() >= birthtime.getDate()
                ? monthsDiff
                : monthsDiff - 1;

            return adjustedDiff >= duration;
          }
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

    const [error, formattedMessage] = mightThrowSync(() => {
      const { formatter } = this.options;
      return formatter?.format(data) ?? "";
    });

    // biome-ignore-start lint/suspicious/noConsole: function used for the correct
    // functionality of the logger
    if (error && error instanceof Error) {
      const { formatter } = this.options;
      console.error(formatter?.formatError(data, error));

      return;
    }

    if (!formattedMessage) return;

    switch (userLevel) {
      case LogLevel.debug:
        console.debug(formattedMessage);
        break;
      case LogLevel.info:
        console.info(formattedMessage);
        break;
      case LogLevel.warning:
        console.warn(formattedMessage);
        break;
      case LogLevel.error:
        console.error(formattedMessage);
        break;
      case LogLevel.critical:
        console.error(formattedMessage);
        break;
      default:
        console.debug(formattedMessage);
        break;
    }
    // biome-ignore-end lint/suspicious/noConsole: function used for the correct
    // functionality of the logger
  }
}
