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

### Example: Console + file

```typescript
const log = new Logger("api", [
  new ConsoleProvider({ level: "info" }),
  new FileProvider("./logs/api.log", {
    policy: { type: "size" },
  }),
]);

log.info("listening");
```

### Example: JSON formatter

```typescript
const log = new Logger("jobs", [
  new ConsoleProvider({
    formatter: new JSONFormatter(),
  }),
]);

log.warning("retry scheduled");
```

### Example: Filter noise

```typescript
const log = new Logger("http", [
  new ConsoleProvider({ level: "warning" }),
]);

log.debug("ignored");
log.warning("slow request");
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
