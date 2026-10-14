import type { LogHost, LogRecord, Scope } from "./types.js";
import { timeUnixNanoString } from "./util.js";

export class Logger {
  public constructor(
    private host: LogHost,
    private scope: Scope,
  ) {}

  public emit(record: LogRecord): void {
    const timeUnixNano = timeUnixNanoString(record.timestamp);

    this.host.onLogEmitted({
      timeUnixNano,
      severityText: record.severityText,
      body: record.body,
      attributes: record.attributes ?? {},
      scopeName: this.scope.scopeName,
      scopeVersion: this.scope.scopeVersion,
    });
  }
}
