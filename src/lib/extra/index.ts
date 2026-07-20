import { mightThrow } from "../errors/index.js";
import { InvalidRetryError } from "./error.js";
import type {
  ErrorMetadataType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryFnType,
  RetryOptions,
} from "./types.js";

const BASE_BACKOFF_DELAY = 1000;
const MAX_BACKOFF_DELAY = 1000 * 60; // 1 minute
const BACKOFF_MULTIPLIER = 2;

class Retry {
  private options: RetryOptions;
  private currentAttempt: number;
  private id: string;

  public constructor(options: RetryOptions) {
    this.options = options;
    this.currentAttempt = 0;
    this.id = this.options.id ?? crypto.randomUUID();
  }

  public async update(ctx: RetryContext) {
    const { maxRetries } = this.options;
    const onRetryErrorResult = this.runOnRetryError(ctx.error, this.id);
    const hasMoreAttempts = this.currentAttempt < maxRetries;
    const canRetry = hasMoreAttempts && onRetryErrorResult;

    if (canRetry) {
      const delay = this.calculateDelay(this.currentAttempt);

      if (this.options.onFailedAttempt) {
        const context: OnFailedAttemptContextType = {
          attemptNumber: this.currentAttempt + 1,
          delay,
          error: ctx.error,
          retriesLeft: maxRetries - this.currentAttempt,
          id: this.id,
        };

        await this.options.onFailedAttempt(context);
      }

      this.currentAttempt += 1;
      await this.runDelay(delay);

      return true;
    }

    return false;
  }

  public async fireOnError(ctx: RetryContext) {
    if (!this.options.onError) return true;

    const data: ErrorMetadataType = {
      failedAt: Date.now(),
      error: ctx.error,
      id: this.id,
    };

    await this.options.onError(data);
    return false;
  }

  private runOnRetryError(error: Error, id: string) {
    if (!this.options.retryOnError) return true;
    return this.options.retryOnError({ error, id });
  }

  private calculateDelay(attempt: number) {
    // exponential backoff with "Full Jitter" algorithm

    const deltaTime = BASE_BACKOFF_DELAY * BACKOFF_MULTIPLIER ** attempt;
    const minDeltaTime = Math.min(deltaTime, MAX_BACKOFF_DELAY);
    return Math.round(Math.random() * (minDeltaTime + 1));
  }

  private async runDelay(delay: number) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function checkAttempts(options: RetryOptions) {
  const { maxRetries } = options;

  const isValidInteger = Number.isSafeInteger(maxRetries);
  const isNegativeZero = Object.is(maxRetries, -0);
  const isNaturalNumber = maxRetries >= 0;

  return isNaturalNumber && isValidInteger && !isNegativeZero;
}

export function createRetry<RetryValue = void>(
  fn: RetryFnType<RetryValue>,
  options: RetryOptions,
) {
  if (!checkAttempts(options)) {
    throw new InvalidRetryError(
      "Expected 'maxRetries' to be a finite non-negative integer",
    );
  }

  return async () => {
    const retry = new Retry(options);

    for (;;) {
      const [fnError, result] = await mightThrow(
        Promise.resolve().then(() => fn()),
      );

      if (!fnError) return result;

      const shouldContinue = await retry.update({ error: fnError });
      if (shouldContinue) continue;

      const shouldThrow = await retry.fireOnError({ error: fnError });
      if (!shouldThrow) return undefined;

      throw fnError;
    }
  };
}

export { InvalidRetryError } from "./error.js";
export type {
  ErrorMetadataType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryFnType,
  RetryOnErrorContextType,
  RetryOptions,
} from "./types.js";
