import { mightThrow } from "../errors/index.js";
import { InvalidRetryError } from "./errors.js";
import type {
  ErrorMetadataType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryOptions,
} from "./types.js";

const BASE_BACKOFF_DELAY = 1000;
const MAX_BACKOFF_DELAY = 1000 * 60; // 1 minute
const BACKOFF_MULTIPLIER = 2;

class Retry<TRetryResult> {
  private options: RetryOptions<TRetryResult>;
  private currentAttempt: number;
  private id: string;

  public constructor(options: RetryOptions<TRetryResult>) {
    this.options = options;
    this.currentAttempt = 0;
    this.id = this.options.id ?? crypto.randomUUID();
  }

  public async update(ctx: RetryContext) {
    const shouldIgnore = this.checkIgnoreErrors(ctx.error);
    if (shouldIgnore) return false;

    const { maxRetries } = this.options;
    const onRetryErrorResult = this.runOnRetryError(ctx.error, this.id);
    const isRetriableError = this.checkRetryErrors(ctx.error);
    const hasMoreAttempts = this.currentAttempt < maxRetries;
    const canRetry = hasMoreAttempts && onRetryErrorResult && isRetriableError;
    if (!canRetry) return false;

    const delay = this.calculateDelay(this.currentAttempt);
    if (this.options.onFailedAttempt) {
      const onFailedAttempt = this.options.onFailedAttempt;
      const context: OnFailedAttemptContextType = {
        attemptNumber: this.currentAttempt + 1,
        delay,
        error: ctx.error,
        retriesLeft: maxRetries - this.currentAttempt,
        id: this.id,
      };

      const [callbackError] = await mightThrow(
        Promise.resolve().then(() => onFailedAttempt(context)),
      );

      if (callbackError) throw ctx.error;
    }

    this.currentAttempt += 1;
    await this.runDelay(delay);

    return true;
  }

  public async fireOnError(ctx: RetryContext) {
    if (!this.options.onError) return true;

    const onError = this.options.onError;
    const data: ErrorMetadataType = {
      failedAt: Date.now(),
      error: ctx.error,
      id: this.id,
    };

    const [callbackError] = await mightThrow(
      Promise.resolve().then(() => onError(data)),
    );

    if (callbackError) throw ctx.error;

    return false;
  }

  private checkIgnoreErrors(error: Error) {
    const { ignoreErrors } = this.options;
    if (!ignoreErrors) return false;

    return ignoreErrors.some((e) => error.constructor === e);
  }

  private checkRetryErrors(error: Error) {
    const { retryErrors } = this.options;
    if (!retryErrors) return true;

    return retryErrors.some((e) => error.constructor === e);
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

function checkAttempts<TRetryResult>(options: RetryOptions<TRetryResult>) {
  const { maxRetries } = options;

  const isValidInteger = Number.isSafeInteger(maxRetries);
  const isNegativeZero = Object.is(maxRetries, -0);
  const isNaturalNumber = maxRetries >= 0;

  return isNaturalNumber && isValidInteger && !isNegativeZero;
}

export function createRetry<TRetryResult = void>(
  options: RetryOptions<TRetryResult>,
) {
  if (!checkAttempts<TRetryResult>(options)) {
    throw new InvalidRetryError(
      "Expected 'maxRetries' to be a finite non-negative integer",
    );
  }

  return async () => {
    const retry = new Retry<TRetryResult>(options);
    const { input: fn } = options;

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

export { InvalidRetryError } from "./errors.js";
export type {
  ErrorMetadataType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryOnErrorContextType,
  RetryOptions,
} from "./types.js";
