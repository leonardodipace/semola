import type { LogHost, LogRecord, Scope } from "./types.js";
import { timeUnixNanoString } from "./util.js";

const SEVERITY_BY_TEXT: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  warning: 13,
  error: 17,
  fatal: 21,
};

export class Logger {
  public constructor(
    private host: LogHost,
    private scope: Scope,
  ) {}

  public emit(record: LogRecord): void {
    const timeUnixNano = timeUnixNanoString(record.timestamp);
    const severityNumber = SEVERITY_BY_TEXT[record.severityText.toLowerCase()];

    this.host.onLogEmitted({
      timeUnixNano,
      severityText: record.severityText,
      severityNumber,
      body: record.body,
      attributes: record.attributes ?? {},
      scopeName: this.scope.scopeName,
      scopeVersion: this.scope.scopeVersion,
    });
  }
}
