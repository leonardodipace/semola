---
title: Cron
description: In-process cron schedules on Bun
---

Run handlers on a schedule inside your process. No OS crontab required for the basic case. Use `CronOS` when you need Bun's OS-level cron registration instead.

## Import

```typescript
import { Cron, CronOS, cronJobBuilder, any, number } from "semola/cron";
```

## Quick start

```typescript
const daily = new Cron({
  name: "daily-report",
  schedule: "@daily",
  handler: async () => {
    await sendReport();
  },
});

daily.run();

// later
daily.stop();
```

## Schedules

### Aliases

`@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`, `@minutely`. You can also pass a standard cron expression string.

### Builder

For typed schedule pieces:

```typescript
import { cronJobBuilder, any, number, Month, WeekDay } from "semola/cron";

const schedule = cronJobBuilder((b) =>
  b.minute(number(0)).hour(number(9)).weekday(any()),
);

const job = new Cron({
  name: "weekday-nudge",
  schedule,
  handler: () => console.log("good morning"),
});
```

Helpers: `any`, `list`, `number`, `range`, `step`, plus `Month` and `WeekDay` enums. Unset fields default to `*`.

### Lifecycle

`next()` returns the next fire time. `ref()` / `unref()` control whether the timer keeps the process alive. `getStatus()`, `getExpression()`, and `getJobName()` inspect the job. Disposing the instance (`Symbol.dispose`) calls `stop`.

## OS crontab

`CronOS` registers a job with Bun's OS cron helper. It needs a script `path`, plus `name` and `schedule` (no in-process handler):

```typescript
import { CronOS } from "semola/cron";

const job = new CronOS({
  name: "nightly-backup",
  schedule: "@daily",
  path: "./scripts/backup.ts",
});

await job.run();
await job.stop();
```

## Examples

### Example: Hourly cleanup

```typescript
const cleanup = new Cron({
  name: "cleanup-temp",
  schedule: "@hourly",
  handler: async () => {
    await clearTempFiles();
  },
});

cleanup.run();
```

### Example: Cron expression

```typescript
const everyFiveMinutes = new Cron({
  name: "sync",
  schedule: "*/5 * * * *",
  handler: async () => {
    await syncRemote();
  },
});

everyFiveMinutes.run();
console.log(everyFiveMinutes.next());
```

### Example: Builder with weekday

```typescript
const mondayMorning = new Cron({
  name: "monday-standup",
  schedule: cronJobBuilder((b) =>
    b.minute(number(0)).hour(number(9)).weekday(number(WeekDay.mon)),
  ),
  handler: () => notifyTeam(),
});
```

### Example: Unref so the process can exit

```typescript
const heartbeat = new Cron({
  name: "heartbeat",
  schedule: "@minutely",
  handler: () => ping(),
});

heartbeat.run();
heartbeat.unref();
```

## Reference

### `Cron` options

| Option | Meaning |
| --- | --- |
| `name` | Job name |
| `schedule` | Alias, cron string, or builder result |
| `handler` | Async or sync function |

### `Cron` methods

| Method | Meaning |
| --- | --- |
| `run()` | Start the schedule |
| `stop()` | Stop the schedule |
| `next(from?)` | Next fire time |
| `ref()` / `unref()` | Keep / release the process |
| `getStatus()` / `getExpression()` / `getJobName()` | Inspect state |

### `CronOS` options

| Option | Meaning |
| --- | --- |
| `name` | Job name |
| `schedule` | Alias or cron string |
| `path` | Script path registered with Bun |

### Errors

`EmptyListError`, `OutOfBoundError` (exported from `semola/cron`).
