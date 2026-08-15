---
title: Extra
description: Small helpers that do not need their own package
---

Odds and ends that are useful but too small for a dedicated module. Today that means retries with full-jitter backoff.

## Import

```typescript
import {
  BACKOFF_MULTIPLIER,
  BASE_BACKOFF_DELAY,
  createRetry,
  InvalidResultError,
  InvalidRetryError,
  MAX_BACKOFF_DELAY,
} from "semola/extra";
import type {
  BackoffOptions,
  ErrorMetadataType,
  HookContextType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryOnErrorContextType,
  RetryOptions,
  RetryOutcomeType,
} from "semola/extra";
```

### API

`
createRetry<TRetryResult = void>(options: RetryOptions<TRetryResult>): () => Promise<RetryOutcomeType<TRetryResult>>
`

`createRetry()` gives you the ability to create a retriable function, by specifying how many times it should retry the provided function.

```typescript
async function getTodo() {
  const url = "https://endpoint/v1/todos/5";
  const response = await fetch(url);

  if (response.status === 404) {
    return undefined;
  }

  return await response.json();
}

const callable = createRetry({ input: getTodo, maxRetries: 3 });
console.log(await callable());
```

`createRetry()` use the following options:
  - `input: () => TRetryResult | Promise<TRetryResult>` (required) -  A synchronous or an asynchronous function you want retry `n` times
  - `maxRetries: number` (required) - Number of retries after the first failure. A successful `input` call will stop its execution. The number of retries must be a finite non-negative integer; if passed an invalid number, `createRetry()` will raise an `InvalidRetryError` error
  - `id?: string` (optional) - Retry's id. By default it's a randomly generated UUID
  - `ignoreErrors?: ErrorClassType[]` (optional) - A list of error constructors to skip retries for. Matching uses exact constructor identity (`error.constructor === e`), not subclasses. Omit it or pass `[]` to ignore none (all errors are retried)
  - `retryErrors?: ErrorClassType[]` (optional) - A list of error constructors that must be retried. Matching uses exact constructor identity, not subclasses. If an error's constructor is not in the list, it is passed to `onError`, if present, or thrown. Omit it or pass `[]` to retry every error
  - `backoff: BackoffOptions` (optional) - A configuration object for handling exponential backoff's parameters. Note that if any of these parameters are invalid, `createRetry()` will throw an `InvalidRetryError` error. All these parameters must be a finite number greater than zero:
    - `baseDelay?: number` (optional) - Base delay in milliseconds. By default it's `1000ms`
    - `multiplier?: number` (optional) - Backoff multiplier. By default it's `2`
    - `maxDelay?: number` (optional) - Maximum delay in milliseconds. By default it's `60000ms` (1 minute)
  - `onError?: (error: ErrorMetadataType<TRetryResult>) => void | Promise<void>` (optional) - Function called when `input` raises an error and retrying stops: retries exhausted, the error is in `ignoreErrors`, `retryOnError` returns false, or `retryErrors` is non-empty and does not include that constructor. If not provided, the instance re-raises that error. The `ErrorMetadataType<TRetryResult>` type contains the following properties:
    - `failedAt: number` - When the function failed, expressed in milliseconds
    - `error: Error | InvalidResultError<TRetryResult>` - Which error was fired inside `input` or which value caused the retry
    - `id: string` - Retry's id
  - `onFailedAttempt?: (ctx: OnFailedAttemptContextType<TRetryResult>) => void | Promise<void>` (optional) - Function called on every failed attempt. The `OnFailedAttemptContextType<TRetryResult>` type contains the following properties:
    - `error: Error | InvalidResultError<TRetryResult>` - Which error was fired inside `input` or which value caused the retry
    - `attempt: number` - The attempt number. Note that they start at 1
    - `retriesRemaining: number` - How many retries remains before stopping
    - `nextRetryDelayMs: number` - Backoff delay, in milliseconds, before the next run, calculated with exponential backoff and [Full Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/). By default, this value is capped at 1 minute
    - `id: string` - Retry's id
  - `retryOnResult?: (result: TRetryResult) => boolean` (optional) - Function that evaluates `input`'s result. This function return `true` if `result` should be retried, otherwise it must return `false`. By default, if not provided, no results are retried;
  - `retryOnError?: (ctx: RetryOnErrorContextType<TRetryResult>) => boolean` (optional) - Function called when `input` throw an error and before consuming a retry. This function return `true` if `input` should consume the current retry, otherwise it must return `false`. By default, if not provided, `input` will retry on every errors. The `RetryOnErrorContextType<TRetryResult>` type contains the following properties:
    - `error: Error | InvalidResultError<TRetryResult>` - Which error was fired inside `input` or which value caused the retry
    - `id: string` - Retry's id
  - `beforeRetry?: (ctx: HookContextType<TRetryResult>) => void | Promise<void>` (optional) - Function called before `onFailedAttempt`. `HookContextType<TRetryResult>` type contains the following properties:
      - `error: Error | InvalidResultError<TRetryResult>` - Which error was fired inside `input` or which value caused the retry
      - `retriesRemaining: number` - How many attempts are still available, before retrying
      - `attempt: number` - Which attempt triggered this retry. Note that they start at 1
      - `id: string` - Retry's id
  - `afterRetry?: (ctx: HookContextType<TRetryResult>) => void | Promise<void>` (optional) - Function called after `onFailedAttempt`. `HookContextType<TRetryResult>` type contains the following properties:
      - `error: Error | InvalidResultError<TRetryResult>` - Which error was fired inside `input` or which value caused the retry
      - `retriesRemaining: number` - How many attempts are still available, after retrying
      - `attempt: number` - Which attempt triggered this retry. Note that they start at 1
      - `id: string` - Retry's id

`createRetry()` returns a function that automatically handles all the retry logic and, after its execution, it returns a `RetryOutcomeType<TRetryResult>` type:
- If `input` succeeded, it returns an object of type `{ ok: true; result: TRetryResult }`; you can find `input`'s result inside the `result` property
- If `input` failed, and `onError` was defined, it returns an object of type `{ ok: false }`. 

An `InvalidResultError` is created when `input`'s return value need to be retried; this class provide a `data` attribute, of type `TRetryResult` containing the value that caused the retry.

If an error was thrown by `onFailedAttempt()`, `beforeRetry()`, `afterRetry()` or `onError()` function, `callable` will re-throw the original error.

### Examples

**Save something inside a file**

The callable retries a failed write up to three times, reports the final failure through `onError`, and returns the byte count on success.

```typescript
const callable = createRetry({
  input: async () => {
    const path = "/path/to/file.txt";
    return await Bun.write(path, "Some data");
  },
  maxRetries: 3,
  backoff: { baseDelay: 1000 * 60, maxDelay: 1000 * 60 * 60 },
  onError: ({ error, failedAt }) => {
    console.error(`[${error.name}]: ${error.message}. Failed at ${failedAt}`);
  },
});

const outcome = await callable();
if (outcome.ok) {
  console.log(`Bytes written: ${outcome.result}`);
}
```

**Stop at a specific error**

`retryOnError` stops retrying when the report is missing, so that error is thrown immediately.

```typescript
type Report = { name: string; completed: boolean; author: string };
class ReportNotFoundError extends Error {}

async function findReport(path: string, id: string) { ... }

const callable = createRetry({
  input: async () => {
    const report = await findReport("/path/to/reports/folder/", "1");

    if (!report) {
      throw new ReportNotFoundError("Report not found: '1'");
    }

    return { name: report.name, author: report.author };
  },
  maxRetries: 3,
  retryOnError: ({ error }) => !(error instanceof ReportNotFoundError),
});

try {
  const outcome = await callable();

  if (outcome.ok) {
    console.log(
      `Author: ${outcome.result.author}  Report's name: ${outcome.result.name}`,
    );
  }
} catch (error) {
  console.error(error);
}
```

**Log every attempt**

`onFailedAttempt` receives the attempt number and calculated jitter delay after each failed call.

```typescript
const callable = createRetry({
  input: async () => {
    const report = await findReport("/path/to/reports/folder/", "1");

    if (!report) {
      throw new ReportNotFoundError("Report not found: '1'");
    }

    return { name: report.name, author: report.author };
  },
  maxRetries: 3,
  onFailedAttempt: ({ attempt, nextRetryDelayMs }) => {
    console.log(
      `Attempt number: ${attempt}. Waiting ${nextRetryDelayMs}ms before the next run`,
    );
  },
});
```

**Call a function with arguments**

The `input` closure captures arguments while the returned callable keeps a zero-argument API.

```typescript
async function execute(command: string) { ... }
const callable = createRetry({
  input: async () => execute("fetch"),
  maxRetries: 5,
});

await callable();
```

**Retry over a small set of errors**

In this example, only `ConnectionTimeOutError` is retried, while `InvalidArgumentError` and `CommandNotFoundError` are ignored. If either of these errors is thrown inside `runCommand()`, `callable()` will re-throw it.

```typescript
class InvalidArgumentError extends Error {}
class CommandNotFoundError extends Error {}
class ConnectionTimeOutError extends Error {}

async function runCommand(command: string, args: string[]) { ... }

const callable = createRetry({
  input: async () => runCommand("push", ["origin", "main"]),
  beforeRetry: (ctx) => {
    console.log(
      `[${ctx.id}] Attempt #${ctx.attempt} failed: ${ctx.error.message}. ` +
        `${ctx.retriesRemaining} retries availables`,
    );
  },
  onFailedAttempt: (ctx) => {
    console.log(`[${ctx.id}] Processing Retry #${ctx.attempt}...`);
  },
  afterRetry: (ctx) => {
    console.log(
      `[${ctx.id}] Retry #${ctx.attempt} finished. ` +
        `${ctx.retriesRemaining} retries remaining`,
    );
  },
  maxRetries: 5,
  ignoreErrors: [InvalidArgumentError, CommandNotFoundError],
  retryErrors: [ConnectionTimeOutError],
});

await callable();
```


### Credits

The retry module was hugely inspired by [Resilience4j](https://resilience4j.readme.io/docs/retry) and [p-ertry](https://github.com/sindresorhus/p-retry) packages.