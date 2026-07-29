---
title: Cron
description: In-process cron schedules on Bun
---

Run handlers on a schedule inside your process. No OS crontab required for the basic case.

```typescript
import { Cron, cronJobBuilder, any, number } from "semola/cron";
```

## Simple schedules

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

Aliases include `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`, `@minutely`. You can also pass a standard cron expression string.

`next()` returns the next fire time. `ref()` / `unref()` control whether the timer keeps the process alive.

## Builder

For typed schedule pieces:

```typescript
import { cronJobBuilder, any, number, Month, WeekDay } from "semola/cron";

const schedule = cronJobBuilder((b) =>
  b.minute(number(0)).hour(number(9)).dayOfWeek(any()),
);

const job = new Cron({
  name: "weekday-nudge",
  schedule,
  handler: () => console.log("good morning"),
});
```

Helpers: `any`, `list`, `number`, `range`, `step`, plus `Month` and `WeekDay` enums.

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
