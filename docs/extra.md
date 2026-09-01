---
title: Extra
description: Small helpers that do not need their own package
---

A container for small and useful functions for your applications and modules.

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
  RetryOnErrorContextType,
  RetryOptions,
  RetryOutcomeType,
} from "semola/extra";
```

### Features

`createRetry()` gives you the ability to create a retriable function, by specifying how many times it should retry the provided function.

## `createRetry()`

It is possible to define a retriable function by calling `createRetry()`. Inside `createRetry()` we can pass the desired function to the `input` property, which accepts both synchronous and asynchronous functions.

```typescript
import { createRetry } from "semola/extra"

type Todo = {
  title: string,
  description: string,
  createdAt: number
}

const callable = createRetry({
  maxRetries: 3,
  input: async () => {
    const result = await fetch("http://localhost:3000/api/v1/todos", { method: "GET" })
    
    if (result.status === 429) {
      throw new Error("Slow down")
    }

    return await result.json() as { data: Todo[] }
  }
})

console.log(await callable())
```

`createRetry()` returns an asynchronous function that wraps everything about retries, like **applying a delay** and **handling the retry lifecycle**. When calling `callable()` for the first time, the input function runs and, in case it fails, it will run again at most `maxRetries` times. By default, it throws the last occured error or, if `input` succedded, it returns `input`'s return value, like our list of todos.

At each call of `callable()`, it's assigned a new unique UUID. You can also provide your own id with the `id` property:

```typescript
import { createRetry } from "semola/extra"

const callableWithCustomId = createRetry({
  maxRetries: 3,
  input: async () => { ... },
  id: "custom-id"
})
```

### Read retry informations 

By adding an `onFailedAttempt()` function, we can access basic information about what went wrong during an attempt.

```typescript
import { createRetry } from "semola/extra"

const callable = createRetry({
  maxRetries: 3,
  input: async () => { ... },
  onFailedAttempt: ({ attempt, nextRetryDelayMs, retriesRemaining }) => {
    console.log(`attempt n. ${attempt} => retrying in ${nextRetryDelayMs}ms. Retries remaining: ${retriesRemaining}`)
    // attempt n. 1 => retrying in 926ms. Retries remaining : 2
    // attempt n. 2 => retrying in 1521ms. Retries remaining: 1
    // attempt n. 3 => retrying in 352ms. Retries remaining: 0
  }
})
```

`onFailedAttempt()` has one parameter with the following property:

| Property | Description | 
|-----|---------|
| `error`                | Which error caused a retry |
| `attempt`              | The attempt number. Note that they start at 1 |
| `retriesRemaining`     | How many retries remains before stopping | 
| `nextRetryDelayMs`     | Backoff delay, in milliseconds, before the next run, calculated with exponential backoff and Full Jitter. By default, this value is capped at `1` minute | 
| `id`                   | Id assigned to `createRetry()`  |


We also provide `beforeRetry()` and `afterRetry()` functions, executed before and after `onFailedAttempt()` function respectively.


```typescript
import { createRetry } from "semola/extra"

const callable = createRetry({
  maxRetries: 3,
  input: async () => { ... },
  beforeRetry: ({ attempt, retriesRemaining }) => {
    console.log(`(before) attempt n. ${attempt} remaining retries: ${retriesRemaining}`)
  },
  onFailedAttempt: ({ attempt, nextRetryDelayMs, retriesRemaining }) => {
    console.log(`  (onFailed) attempt n. ${attempt} remaining retries: ${retriesRemaining}`)
  },
  afterRetry: ({ attempt, retriesRemaining }) => {
    console.log(`(after) attempt n. ${attempt} remaining retries: ${retriesRemaining}\n`)
  },
})

await callable()
```

When calling `callable()` we can see the following output:

```bash
(before) attempt n. 1 remaining retries: 3
  (onFailed) attempt n. 1 remaining retries: 2
(after) attempt n. 1 remaining retries: 2

(before) attempt n. 2 remaining retries: 2
  (onFailed) attempt n. 2 remaining retries: 1
(after) attempt n. 2 remaining retries: 1

(before) attempt n. 3 remaining retries: 1
  (onFailed) attempt n. 3 remaining retries: 0
(after) attempt n. 3 remaining retries: 0
```

Both `beforeRetry()` and `afterRetry()` has one parameter with the same property of `onFailedAttempt()`'s parameter, excluded `nextRetryDelayMs`. 

You can also pass an asynchronous functions to `beforeRetry`, `afterRetry` and `onFailedAttempt` properties if you need to, for instance, save a report of the error inside a file or a database.

### Ignore errors

We can create a list of exception classes and subclasses we don't want to retry and handle differently outside the attempt's life cycle, with the `ignoreErrors` property:

```typescript
import { createRetry } from "semola/extra"

type Todo = {
  title: string,
  description: string,
  createdAt: number
}

class RateLimitError extends Error {}

const callable = createRetry({
  maxRetries: 3,
  input: async () => {
    const result = await fetch("http://localhost:3000/api/v1/todos", { method: "GET" })
    
    if (result.status === 429) {
      throw new RateLimitError("Slow down")
    }

    return await result.json() as { data: Todo[] }
  },
  ignoreErrors: [RateLimitError]
})

await callable()
```

You can think of it like a black list of errors you don't want handle inside `createRetry()`'s context. If an error is ignored, `callable()` will throw that error. 

By default, it's an empty list meaning **all exceptions are retried**. 

### Match errors

Similarly to `ignoreErrors`, `retryErrors` is a list of exception classes and subclasses we want to retry inside the attempt's life cycle:

```typescript
import { createRetry } from "semola/extra"

type Todo = {
  title: string,
  description: string,
  createdAt: number
}

class BaseServerError extends Error {}
class RateLimitError extends Error {}
class ServiceUnavailableError extends BaseServerError {}

const callable = createRetry({
  maxRetries: 3,
  input: async () => {
    const result = await fetch("http://localhost:3000/api/v1/todos", { method: "GET" })
    
    if (result.status === 503) {
      throw new ServiceUnavailableError("Oh no!")
    }

    if (result.status === 429) {
      throw new RateLimitError("Slow down")
    }

    return await result.json() as { data: Todo[] }
  },
  onFailedAttempt: ({ error }) => {
    console.log(error.message)
  },
  ignoreErrors: [ServiceUnavailableError],
  retryErrors: [RateLimitError]
})

await callable()
```

You can think of it like a subset of errors you want handle inside `createRetry()`'s context. If an error is not in the `retryErrors` list, `callable()` will throw that error. 

By default, it's an empty list meaning **all exceptions are matched and retried**.


### Retry over errors

If you need more control on if an error should be retried or not, we can use the `retryOnError` property. This property accept a function that returns `true` if we want to consume the current retry and thus run retry it; otherwise it must return `false`.

```typescript
import { createRetry } from "semola/extra"

type Todo = {
  title: string,
  description: string,
  createdAt: number
}

class RateLimitError extends Error {}

const callable = createRetry({
  maxRetries: 3,
  input: async () => {
    const result = await fetch("http://localhost:3000/api/v1/todos", { method: "GET" })
    
    if (result.status === 429) {
      throw new RateLimitError("Slow down")
    }

    return await result.json() as { data: Todo[] }
  },
  retryOnError: ({ error }) => error instanceof RateLimitError
})

await callable()
```
By default, if not provided, a retry is consumed on every errors.

`retryOnError` use one parameter with the following properties: 

| Property | Description | 
|-----|---------|
| `error`                | Which error caused a retry |
| `id`                   | Id assigned to `createRetry()`  |


### Retry over results

Similarly to `retryOnError`, `retryOnResult` accept a function that evaluates `input`'s result. It returns `true` if we should retry, otherwise it must return `false`.

```typescript
import { createRetry } from "semola/extra"

type Todo = {
  title: string,
  description: string,
  createdAt: number
}

const callable = createRetry({
  maxRetries: 3,
  input: async () => {
    const result = await fetch("http://localhost:3000/api/v1/todos", { method: "GET" })
    if (result.status === 404) return { data: undefined }
    
    return await result.json() as { data: Todo[] }
  },
  retryOnResult: (obj) => {
    const { data } = obj
    if (!data) return false;

    return true;
  }
})

await callable()
```

`retryOnResult` has one parameter, containing `input`'s return value. In our case, the parameter `obj` is an object of type `{ data: Todo[] | undefined }`.

By default, if not provided, no results are retried and thus considered *"valid"*.

### Backoff delay

Each delay is calculated based on the [exponential backoff with full jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) with the following default parameters:


| Parameter          | Default value | 
|--------------------|---------------|
| `baseDelay`               | `1000` ms |
| `maxDelay`          | `1` minute |
| `multiplier` | `2` | 

We can use the `backoff` property to configure custom values for each parameter:

```typescript
import { createRetry } from "semola/extra"

const callable = createRetry({
  maxRetries: 3,
  input: async () => { ... },
  backoff: {
    baseDelay: 1000 * 3, // 3 seconds
    multiplier: 1.5,
    maxDelay: 1000 * 60 * 60 // 1 hour
  }
})
```

### Handling errors

By default, your `callable()` throws the last occurred exception, either because it exhausted all the available retries or because the exception was added inside the `ignoreErrors` list. In case you don't want this behaviour, you can use the `onError()` function to intercept these errors and handle them without a `try...catch`:


```typescript
import { createRetry } from "semola/extra"

type Todo = {
  title: string;
  description: string;
  createdAt: number;
};

class RateLimitError extends Error {}

const callable = createRetry({
  maxRetries: 3,
  input: async () => { ... },
  onError: ({ error, failedAt, id }) => {
    console.error(
      `retry-id=${id}  failedAt=${failedAt}, error-message=${error.message}`,
    );
  },
  ignoreErrors: [RateLimitError],
});

await callable();
```

In the above example, if `input` failed 3 times or, if it throw a `RateLimitError` exception, the `onError()` function is executed. 

After printing the retry's id, the timestamp and the error's message, `callable()` returns the object `{ ok: false }`, meaning that the entire retry's life cycle failed.

`onError()` has one parameter with the following property:

| Property | Description | 
|-----|---------|
| `error`                | Which error caused a retry |
| `failedAt`             | When the error occured, expressed in milliseconds |
| `id`                   | Id assigned to `createRetry()`  |

In case the `input` function failed because of an invalid result, reported by `retryOnResult()`, you can read which value caused the last occured error:

```typescript
import { createRetry, InvalidResultError } from "semola/extra"

type Todo = {
  title: string;
  description: string;
  createdAt: number;
};

const callable = createRetry({
  maxRetries: 3,
  input: async () => {
    const result = await fetch("http://localhost:3000/api/v1/todos", {
      method: "GET",
    });

    if (result.status === 404) return { data: undefined };

    return (await result.json()) as { data: Todo[] };
  },
  retryOnResult: (result) => {
    return result.data === undefined;
  },
  onError: ({ error, failedAt, id }) => {
    if (error instanceof InvalidResultError) {
      console.error(
        `retry-id=${id}  failedAt=${failedAt}, error-message=${error.message} error-value=${error.data}`,
      );
    }
  },
});

await callable();
```
the `InvalidResultError` is created when `input`'s return value is considered invalid and cannot be retried. It provides a public `data` attribute, of type `TRetryResult`, containing `input`'s return value, that caused the retry. 

In our case, this value will be `{ data: undefined }`.

## Reference

### `createRetry()`

Create an asynchronous function that wraps all retry logic and state.

**Syntaxt**

```typescript
createRetry<TRetryResult>(
  options: RetryOptions<TRetryResult>
): () => Promise<RetryOutcomeType<TRetryResult>>
```

**Generic Types**

- `TRetryResult` - Type of `input`'s return value. By default it's `void`

**Parameters**

- `options: RetryOptions<TRetryResult>` - Configure which function should be retried, how many times it should be retried and how to handle retries' lifecycle 

**Return value**

An asynchronous functions. 

If `onError` is set, this function returns an object of type `RetryOutcomeType<TRetryResult>` where, based on `input`'s state, it can be equals to: 
- `{ ok: true; result: TRetryResult }` if `input` succedded, it contains `input`'s returned value; otherwise
- `{ ok: false; }` if `input` failed

If `onError` is not set, the returned fuction reject with the last occurred error.

### Errors

#### InvalidRetryError

An `InvalidRetryError` is thrown when passing a negative or a non-finite number to `maxRetries`, `baseDelay`, `multiplier` or `maxDelay` properties.

**Constructor**

```typescript
InvalidRetryError(message: string)
```

**Parameters**
- `message: string` - Error message

#### InvalidResultError 

An `InvalidResultError` is thrown in case `input`'s return value is considered invalid.

**Constructor**

```typescript
InvalidResultError<TRetryResult>(data: TRetryResult, message: string)
```
**Parameters**

- `data: TRetryResult` - Value considered invalid
- `message: string` - Error message

**Generic Types**

- `TRetryResult` - Type of `input`'s return value. By default it's `void`

**Attributes**

- `data: TRetryResult` - Invalid value returned by `input`


### Constants

| Constant | Description |
| --- | --- |
| `BASE_BACKOFF_DELAY` | Default base delay equals to `1000`ms, or `1` second |
| `BACKOFF_MULTIPLIER` | Default multiplier equals to `2` |
| `MAX_BACKOFF_DELAY` | Default maximum delay equals to `60000`ms, or `1` minute |


### Types

#### RetryOptions

A configuration object passed as input for `createRetry()`

| Property | Type | Description | Required |
| --- | --- | --- | --- |
| `input` | `() => TRetryResult \| Promise<TRetryResult>` | Synchronous or asynchronous functions to retry | yes |
| `maxRetries` | `number` | Number of retries | yes |
| `id` | `string` | Retry id. By default, it's set to a unique UUID | `-` |
| `ignoreErrors` | `ErrorClassType[]` | List of exception classes and subclasses to ignore and thus not retried. If not set, all exceptions are retried | `-` |
| `retryErrors` | `ErrorClassType[]` | List of exception classes and subclasses to match and thus retried. If not set, all exceptions are retried | `-` |
| `backoff` | `BackoffOptions` | Configure exponential backoff's parameters | `-` |
| `onError` | `(error: ErrorMetadataType<TRetryResult>) => void \| Promise<void>` | If set, it catch the last occurred error | `-` |
| `onFailedAttempt` | `(ctx: OnFailedAttemptContextType<TRetryResult>) => void \| Promise<void>` | If set, it's called on each failed attempt | `-` |
| `retryOnResult` | `(result: TRetryResult) => boolean` | A function that returns `true` if `result` should be retried; otherwise it returns `false` | `-` |
| `retryOnError` | `(ctx: RetryOnErrorContextType<TRetryResult>) => boolean` | A function that returns `true` if an error should be retried; otherwise it returns `false` | `-` |
| `beforeRetry` | `(ctx: HookContextType<TRetryResult>) => void \| Promise<void>` | A function that runs before the current attempt is consumed | `-` |
| `afterRetry` | `(ctx: HookContextType<TRetryResult>) => void \| Promise<void>;` | A function that runs after the current attempt was consumed | `-` |


#### BackoffOptions

A configuration object for exponential backoff's parameters

| Property | Type | Description | Required |
| --- | --- | --- | --- |
| `baseDelay`  | `number` | base delay in millisecond | `-` |
| `multiplier` | `number` | multiplicative factor | `-` |
| `maxDelay` | `number` | delay's maximum value in milliseconds | `-` |

#### ErrorMetadataType

Type that group metadata relative to `onError` context

| Property | Type | Description | Required |
| --- | --- | --- | --- |
|`error`| `Error \| InvalidResultError<TRetryResult>` |	Which error caused a retry | yes |
|`failedAt`| `number` |	When the error occured, expressed in milliseconds | yes |
|`id`| `string` |	Id assigned to `createRetry()`. By default it's a random UUID | yes |

**Generic Types**

- `TRetryResult` - Type of `input`'s return value. By default it's `void`

#### HookContextType

Type that group metadata relative to `beforeRetry` and `afterRetry` context.

| Property | Type | Description | Required |
| --- | --- | --- | --- |
|`error`| `Error \| InvalidResultError<TRetryResult>` |	Which error caused a retry | yes |
|`id`| `string` |	Id assigned to `createRetry()`. By default it's a random UUID | yes |
|`retriesRemaining`| `number` |	How many retries remains before stopping | yes |
|`attempt`| `number` |	Current attempt | yes |

**Generic Types**

- `TRetryResult` - Type of `input`'s return value. By default it's `void`

#### OnFailedAttemptContextType

Type that group metadata relative to `onFailedAttempt` context.

| Property | Type | Description | Required |
| --- | --- | --- | --- |
| `error`  |  `Error \| InvalidResultError<TRetryResult>` | Which error caused a retry | yes |
| `attempt`  | `number` | Current attempt | yes |
| `retriesRemaining` | `number` | How many retries remains before stopping |  yes |
| `nextRetryDelayMs` | `number` | Backoff delay, in milliseconds, before the next run, calculated with exponential backoff and Full Jitter. By default, this value is capped at `1` minute |  yes |
| `id` | `string` | Id assigned to `createRetry()`. By default it's a random UUID  | yes |

**Generic Types**

- `TRetryResult` - Type of `input`'s return value. By default it's `void`

#### RetryOnErrorContextType

Type that group metadata relative to `retryOnError` context.

| Property | Type | Description | Required |
| --- | --- | --- | --- |
| `error`|  `Error \| InvalidResultError<TRetryResult>` | Which error caused a retry | yes |
| `id` | `string` | Id assigned to `createRetry()`. By default it's a random UUID  | yes |

**Generic Types**

- `TRetryResult` - Type of `input`'s return value. By default it's `void`


## Credits

`createRetry()` was hugely inspired by [Resilience4j](https://resilience4j.readme.io/docs/retry) and [p-ertry](https://github.com/sindresorhus/p-retry) packages.