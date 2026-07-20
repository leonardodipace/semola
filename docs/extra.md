# Extra

A collection of small, focused utility functionalities that help you reduce boilerplate.

## Retry

A tiny wrapper for retrying any sync or async functions.

### Import 

```typescript
import { createRetry, InvalidRetryError } from "semola/retry";
```

### API

`
createRetry<RetryValue = void>(fn: RetryFnType<RetryValue>, options: RetryOptions): () => Promise<RetryValue | undefined>
`

Creates a retriable function.

```typescript
async function getTodo() {
  const url = "https://endpoint/v1/todos/5";
  const response = await fetch(url);

  if (response.status === 404) {
    return undefined;
  }

  return await response.json();
}

const callable = createRetry(getTodo, { maxRetries: 3 });
console.log(await callable());
```

`createRetry()` need the following parameters:
- `fn: RetryFnType<RetryValue>` (required) - A synchronous or an asynchronous function you want retry `n` times. `RetryFnType` is an alias for `RetryValue | Promise<RetryValue>`, where `RetryValue` is the return type of `fn`. By default `fn` does not return a value.
- `options: RetryOptions`:
  - `maxRetries: number` (required) - Number of retries after the first failure. A successful `fn` run will stop it's execution. The number of retries must be a finite non-negative integer; invalid values raise an `InvalidRetryError` error;
  - `id?: string` (optional) - retry's id. By default it's a randomly generated UUID;
  - `onError?: (error: ErrorMetadataType) => void | Promise<void>` (optional) - Function called when an error is raised inside `fn`, after all retries have been exhausted, with the final error passed in as the argument. If not provided, the instance re-raises that error. The `ErrorMetadataType` type contains the following properties:
    - `failedAt: number` - When the function failed, expressed in milliseconds
    - `error: Error` - Which error was fired inside `fn`
    - `id: string` - retry's id
  - `onFailedAttempt?: (ctx: OnFailedAttemptContextType) => void | Promise<void>` (optional) - Function called on every failed attempt. The `OnFailedAttemptContextType` type contains the following properties:
    - `error: Error` - Which error was fired inside `fn`
    - `attemptNumber: number` - The attempt number. Note that they start at 1
    - `retriesLeft: number` - How many retries remains before stopping
    - `id: string` - retry's id
    - `delay: number` - Backoff delay, in milliseconds before the next run, calculated with exponential backoff and [Full Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/). Note that the delay is capped at 1 minute
  - `retryOnError?: (ctx: RetryOnErrorContextType) => boolean` (optional) - Function called when `fn` throw an error and before consuming a retry. This function return `true` if `fn` should consume the current retry, otherwise it must return `false`. By default, if not provided, `fn` will retry on every errors. The `RetryOnErrorContextType` type contains the following properties:
    - `error: Error` - Which error was fired inside `fn`
    - `id: string` - retry's id

`createRetry()` returns a function that automatically handles all the retry logic. Note that if the `onError()` callback is defined, the function returned by `createRetry()` will return `undefined` instead of throwing when all retries are exhausted.

### Usage Example

Save something inside a file

```typescript
const callable = createRetry(
  async () => {
    const path = "/path/to/file.txt";
    return await Bun.write(path, "Some data");
  },
  {
    maxRetries: 3,
    onError: ({ error, failedAt }) => {
      console.error(`[${error.name}]: ${error.message}. Failed at ${failedAt}`);
    },
  },
);

console.log(`Content: ${await callable()}`);
```

Stop at a specific error

```typescript
type Report = { name: string; completed: boolean; author: string };
class ReportNotFoundError extends Error {}

async function fetchReport(path: string, id: string) { ... }

const callable = createRetry(
  async () => {
    const report = await fetchReport("/v1/reports/", "1");
    return { name: report.name, author: report.author };
  },
  {
    maxRetries: 3,
    retryOnError: ({ error }) => !(error instanceof ReportNotFoundError),
  },
);

console.log(`Report: ${await callable()}`);
```

Log attempts

```typescript
type Report = { name: string; completed: boolean; author: string };

async function fetchReport(path: string, id: string) { ... }

const callable = createRetry(
  async () => {
    const report = await fetchReport("/v1/reports/", "1");
    return { name: report.name, author: report.author };
  },
  {
    maxRetries: 3,
    onFailedAttempt: ({ attemptNumber, delay }) => {
      console.log(
        `Attempt number: ${attemptNumber}. Waiting ${delay}ms before the next run`,
      );
    },
  },
);

console.log(`Report: ${await callable()}`);
```

Call a function with arguments

```typescript
async function execute(command: string) { ... }
const callable = createRetry(async () => execute("fetch"), {
  maxRetries: 5,
});

await callable();
```