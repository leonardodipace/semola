import { appendFileSync } from "node:fs";
import type { Formatter } from "./formatter.js";
import {
  type LogDataType,
  type LoggingOptions,
  LogLevel,
  type LogLevelType,
} from "./types.js";

export class FileLogger {
  protected options: LoggingOptions;
  protected formatter!: Formatter;
  protected file: string;

  constructor(file: string, options: LoggingOptions) {
    this.options = options;
    this.file = file;
  }

  protected getLogLevel() {
    if (!this.options.level) {
      return LogLevel.DEBUG;
    }

    return this.options.level;
  }

  public setFormatter(formatter: Formatter) {
    this.formatter = formatter;
  }

  protected createLogData(level: LogLevelType, msg: string): LogDataType {
    return {
      level,
      msg,
      prefix: this.options.prefix,
    };
  }

  public async debug(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.DEBUG) return;

    if (this.formatter) {
      const data = this.createLogData("DEBUG", msg);
      appendFileSync(this.file, this.formatter.format(data));
    } else {
      appendFileSync(this.file, msg);
    }

    appendFileSync(this.file, "\n");
  }

  public async info(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.INFO) return;

    if (this.formatter) {
      const data = this.createLogData("INFO", msg);
      appendFileSync(this.file, this.formatter.format(data));
    } else {
      appendFileSync(this.file, msg);
    }

    appendFileSync(this.file, "\n");
  }

  public async warning(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.WARNING) return;

    if (this.formatter) {
      const data = this.createLogData("WARNING", msg);
      appendFileSync(this.file, this.formatter.format(data));
    } else {
      appendFileSync(this.file, msg);
    }

    appendFileSync(this.file, "\n");
  }

  public async error(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.ERROR) return;

    if (this.formatter) {
      const data = this.createLogData("ERROR", msg);
      appendFileSync(this.file, this.formatter.format(data));
    } else {
      appendFileSync(this.file, msg);
    }

    appendFileSync(this.file, "\n");
  }

  public async critical(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.CRITICAL) return;

    if (this.formatter) {
      const data = this.createLogData("CRITICAL", msg);
      appendFileSync(this.file, this.formatter.format(data));
    } else {
      appendFileSync(this.file, msg);
    }

    appendFileSync(this.file, "\n");
  }
}

export class ConsoleLogger {
  protected options: LoggingOptions;
  protected formatter!: Formatter;

  constructor(options: LoggingOptions) {
    this.options = options;
  }

  protected getLogLevel() {
    if (!this.options.level) {
      return LogLevel.DEBUG;
    }

    return this.options.level;
  }

  public setFormatter(formatter: Formatter) {
    this.formatter = formatter;
  }

  protected createLogData(level: LogLevelType, msg: string): LogDataType {
    return {
      level,
      msg,
      prefix: this.options.prefix,
    };
  }

  public debug(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.DEBUG) return;

    if (this.formatter) {
      const data = this.createLogData("DEBUG", msg);
      console.debug(this.formatter.format(data));
    } else {
      console.debug(msg);
    }
  }

  public info(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.INFO) return;

    if (this.formatter) {
      const data = this.createLogData("INFO", msg);
      console.info(this.formatter.format(data));
    } else {
      console.info(msg);
    }
  }

  public warning(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.WARNING) return;

    if (this.formatter) {
      const data = this.createLogData("WARNING", msg);
      console.warn(this.formatter.format(data));
    } else {
      console.warn(msg);
    }
  }

  public error(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.ERROR) return;

    if (this.formatter) {
      const data = this.createLogData("ERROR", msg);
      console.error(this.formatter.format(data));
    } else {
      console.error(msg);
    }
  }

  public critical(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.CRITICAL) return;

    if (this.formatter) {
      const data = this.createLogData("CRITICAL", msg);
      console.error(this.formatter.format(data));
    } else {
      console.error(msg);
    }
  }
}
