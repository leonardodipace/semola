---
title: Logging
description: Prefixed loggers with console and file providers
---

Structured-enough logging without pulling in a framework. One logger, one or more providers, optional formatters.

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

The first argument is a prefix shown on every line. Pass several providers to fan out:

```typescript
const log = new Logger("worker", [
  new ConsoleProvider(),
  new FileProvider("./logs/worker.log"),
]);
```

## Levels and format

`LogLevel` enumerates severity. Providers accept options (level filters, formatters). `JSONFormatter` emits JSON lines; date helpers (`isoDateFormat`, `isoDateTimeFormat`, `dmyFormat`, `mdyFormat`) help with timestamps.

Extend `AbstractLogger` or `LoggerProvider` if you need a custom sink. Most apps only need `Logger` + `ConsoleProvider`.
