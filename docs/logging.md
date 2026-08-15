---
title: Logging
description: Prefixed loggers with console and file providers
---

Structured-enough logging without pulling in a framework. One logger, one or more providers, optional formatters.

## Import

```typescript
import {
  Logger,
  LogLevel,
  ConsoleProvider,
  FileProvider,
  JSONFormatter,
} from "semola/logging";
```

## Quick start

One `Logger` sends five severity levels to the console, prefixing every line with `api`.

```typescript
const log = new Logger("api", [new ConsoleProvider()]);

log.debug("handshake");
log.info("server started");
log.warning("slow query");
log.error("request failed");
log.critical("cannot reach database");
```

The first argument is a prefix shown on every line.

## Providers

Pass several providers to fan out:

Each log call writes the same formatted entry to both the console and file.

```typescript
const log = new Logger("worker", [
  new ConsoleProvider(),
  new FileProvider("./logs/worker.log"),
]);
```

### Levels and formatters

`LogLevel` enumerates severity. Providers accept a minimum `level` (default `"debug"`) and a `formatter` (default `BaseFormatter`).

`JSONFormatter` emits JSON lines. Date helpers (`isoDateFormat`, `isoDateTimeFormat`, `dmyFormat`, `mdyFormat`) help with timestamps.

`FileProvider` accepts a path and optional rotation `policy` (size-based by default, or time-based). A `.json` path writes simple JSON lines.

## Examples

### Console and file providers

Info-and-higher entries go to the console, while the file provider writes and rotates `api.log`.

```typescript
const log = new Logger("api", [
  new ConsoleProvider({ level: "info" }),
  new FileProvider("./logs/api.log", {
    policy: { type: "size" },
  }),
]);

log.info("listening");
```

### JSON formatter

The provider formats each entry as one JSON object per line.

```typescript
const log = new Logger("jobs", [
  new ConsoleProvider({
    formatter: new JSONFormatter(),
  }),
]);

log.warning("retry scheduled");
```

### Filter noise

The warning threshold drops the debug entry and emits the warning.

```typescript
const log = new Logger("http", [
  new ConsoleProvider({ level: "warning" }),
]);

log.debug("ignored");
log.warning("slow request");
```

### Date formatter helpers

Date helpers return timestamp strings and can be passed directly to a formatter.

```typescript
const formatter = new BaseFormatter(isoDateTimeFormat);

const log = new Logger("api", [
  new ConsoleProvider({ formatter }),
]);
```

### Custom logger

Extending `AbstractLogger` lets a specialized logger define its own severity behavior.

```typescript
class SilentLogger extends AbstractLogger {
  public debug() {}
  public info() {}
  public warning() {}
  public error() {}
  public critical() {}
}

const log = new SilentLogger("app", [new ConsoleProvider()]);
log.info("ready");
```

### Custom provider

Extending `LoggerProvider` creates a new sink. `execute()` receives each routed entry, and `getLogLevel()` exposes its configured threshold.

```typescript
class MemoryProvider extends LoggerProvider {
  public entries: LogDataType[] = [];

  public execute(data: LogDataType) {
    this.entries.push(data);
  }
}
```

## Reference

### `Logger`

| Call | Meaning |
| --- | --- |
| `new Logger(prefix, providers)` | Create a logger |
| `debug` / `info` / `warning` / `error` / `critical` | Log at that level |

### Providers

| Export | Meaning |
| --- | --- |
| `ConsoleProvider` | Write to the console |
| `FileProvider` | Write to a file (optional rotation) |
| `JSONFormatter` / `BaseFormatter` | Format log lines |

Extend `AbstractLogger` or `LoggerProvider` if you need a custom sink. Most apps only need `Logger` + `ConsoleProvider`.
