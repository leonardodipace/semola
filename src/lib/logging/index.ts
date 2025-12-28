import { type LoggingOptions, LogLevel } from "./types.js";

export class Logger {
  private options: LoggingOptions;

  constructor(options: LoggingOptions) {
    this.options = options;
  }

  public debug(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.DEBUG) return;

    console.debug(msg);
  }

  public info(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.INFO) return;

    console.log(msg);
  }

  public warning(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.WARNING) return;

    console.warn(msg);
  }

  public error(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.ERROR) return;

    console.error(msg);
  }

  public critical(msg: string) {
    const level = this.getLogLevel();
    if (level > LogLevel.CRITICAL) return;

    console.error(msg);
  }

  public getLogLevel() {
    if (!this.options.level) {
      return LogLevel.DEBUG;
    }

    return this.options.level;
  }
}
