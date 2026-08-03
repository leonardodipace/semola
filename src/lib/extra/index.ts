import { mightThrow } from "../errors/index.js";
import { InvalidResultError, InvalidRetryError } from "./errors.js";
import { Retry } from "./retry.manager.js";
import type {
  BackoffOptions,
  RetryOptions,
  RetryOutcomeType,
} from "./types.js";

function checkAttempts<TRetryResult>(options: RetryOptions<TRetryResult>) {
  const { maxRetries } = options;

  const isValidInteger = Number.isSafeInteger(maxRetries);
  const isNegativeZero = Object.is(maxRetries, -0);
  const isNaturalNumber = maxRetries >= 0;

  return isNaturalNumber && isValidInteger && !isNegativeZero;
}

function checkBackoffParameter(
  name: keyof BackoffOptions,
  paramValue?: number,
) {
  if (paramValue === undefined) return;

  if (paramValue < 0) {
    throw new InvalidRetryError(`Expected '${name}' to be a positive number`);
  }

  if (paramValue === 0) {
    throw new InvalidRetryError(`Expected '${name}' to be greater than zero`);
  }

  if (Number.isNaN(paramValue)) {
    throw new InvalidRetryError(`Expected '${name}' to be a valid number`);
  }

  if (!Number.isFinite(paramValue)) {
    throw new InvalidRetryError(`Expected '${name}' to be a finite number`);
  }
}

export function createRetry<TRetryResult = void>(
  options: RetryOptions<TRetryResult>,
) {
  if (!checkAttempts<TRetryResult>(options)) {
    throw new InvalidRetryError(
      "Expected 'maxRetries' to be a finite non-negative integer",
    );
  }

  checkBackoffParameter("baseDelay", options.backoff?.baseDelay);
  checkBackoffParameter("multiplier", options.backoff?.multiplier);
  checkBackoffParameter("maxDelay", options.backoff?.maxDelay);

  return async (): Promise<RetryOutcomeType<TRetryResult>> => {
    const retry = new Retry<TRetryResult>(options);
    const { input: fn } = options;

    for (;;) {
      const [fnError, result] = await mightThrow(
        Promise.resolve().then(() => fn()),
      );

      if (!fnError) {
        const shouldRetryOnResult = retry.retryOverResult(result);
        if (!shouldRetryOnResult) return { ok: true, result };

        const resultError = new InvalidResultError<TRetryResult>(
          result,
          `Retrying because 'retryOnResult' rejected the returned result`,
        );

        const shouldContinue = await retry.retryOverError({
          error: resultError,
        });

        if (shouldContinue) continue;

        const shouldThrow = await retry.fireOnError(resultError);
        if (!shouldThrow) break;

        throw resultError;
      }

      const shouldContinue = await retry.retryOverError({ error: fnError });
      if (shouldContinue) continue;

      const shouldThrow = await retry.fireOnError(fnError);
      if (!shouldThrow) break;

      throw fnError;
    }

    return { ok: false };
  };
}

export { InvalidResultError, InvalidRetryError } from "./errors.js";
export {
  BACKOFF_MULTIPLIER,
  BASE_BACKOFF_DELAY,
  MAX_BACKOFF_DELAY,
} from "./retry.manager.js";
export type {
  BackoffOptions,
  ErrorMetadataType,
  HookContextType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryOnErrorContextType,
  RetryOptions,
  RetryOutcomeType,
} from "./types.js";
