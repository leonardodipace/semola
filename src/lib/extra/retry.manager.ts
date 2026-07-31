import { mightThrow } from "../errors/index.js";
import type {
  BackoffOptions,
  ErrorMetadataType,
  OnFailedAttemptContextType,
  RetryContext,
  RetryOptions,
} from "./types.js";

export const BASE_BACKOFF_DELAY = 1000;
export const MAX_BACKOFF_DELAY = 1000 * 60; // 1 minute
export const BACKOFF_MULTIPLIER = 2;

export class Retry<TRetryResult> {
  protected backoff: Required<BackoffOptions>;
  private options: RetryOptions<TRetryResult>;
  private currentAttempt: number;
  private id: string;

  public constructor(options: RetryOptions<TRetryResult>) {
    this.options = options;
    this.currentAttempt = 1;
    this.id = this.options.id ?? crypto.randomUUID();
    this.backoff = {
      baseDelay: options.backoff?.baseDelay ?? BASE_BACKOFF_DELAY,
      multiplier: options.backoff?.multiplier ?? BACKOFF_MULTIPLIER,
      maxDelay: options.backoff?.maxDelay ?? MAX_BACKOFF_DELAY,
    };
  }

  public async retryOverError(ctx: RetryContext) {
    const hasAttempts = this.hasMoreAttempts();
    if (!hasAttempts) return false;

    const shouldIgnore = this.checkIgnoreErrors(ctx.error);
    if (shouldIgnore) return false;

    const onRetryErrorResult = this.runRetryOnError(ctx.error, this.id);
    if (!onRetryErrorResult) return false;

    const isRetriableError = this.checkRetryErrors(ctx.error);
    if (!isRetriableError) return false;

    await this.fireBeforeAttempt(ctx.error);
    await this.update(ctx);
    await this.fireAfterAttempt(ctx.error);

    return true;
  }

  public async update(ctx: RetryContext) {
    const delay = this.calculateDelay(this.currentAttempt);
    await this.runOnFailedAttempt(delay, ctx.error);

    this.currentAttempt += 1;
    await this.runDelay(delay);
  }

  public async fireOnError(error: Error) {
    if (!this.options.onError) return true;

    const onError = this.options.onError;
    const data: ErrorMetadataType<TRetryResult> = {
      failedAt: Date.now(),
      error,
      id: this.id,
    };

    const [callbackError] = await mightThrow(
      Promise.resolve().then(() => onError(data)),
    );

    if (callbackError) throw error;

    return false;
  }

  public retryOverResult(result: TRetryResult) {
    if (!this.options.retryOnResult) return false;

    return this.options.retryOnResult(result);
  }

  public async fireBeforeAttempt(error: Error) {
    const { beforeRetry, maxRetries } = this.options;
    if (!beforeRetry) return;

    const [callbackError] = await mightThrow(
      Promise.resolve().then(() =>
        beforeRetry({
          currentAttempt: this.currentAttempt,
          retriesRemaining: maxRetries,
          id: this.id,
          error,
        }),
      ),
    );

    if (callbackError) throw error;
  }

  public async fireAfterAttempt(error: Error) {
    const { afterRetry, maxRetries } = this.options;
    if (!afterRetry) return;

    const [callbackError] = await mightThrow(
      Promise.resolve().then(() =>
        afterRetry({
          currentAttempt: this.currentAttempt,
          retriesRemaining: maxRetries - this.currentAttempt,
          id: this.id,
          error,
        }),
      ),
    );

    if (callbackError) throw error;
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

  private hasMoreAttempts() {
    return this.currentAttempt <= this.options.maxRetries;
  }

  private runRetryOnError(error: Error, id: string) {
    if (!this.options.retryOnError) return true;

    return this.options.retryOnError({ error, id });
  }

  private async runOnFailedAttempt(delay: number, error: Error) {
    if (!this.options.onFailedAttempt) return;

    const { maxRetries } = this.options;
    const onFailedAttempt = this.options.onFailedAttempt;
    const context: OnFailedAttemptContextType<TRetryResult> = {
      attempt: this.currentAttempt,
      nextRetryDelayMs: delay,
      error,
      retriesRemaining: maxRetries - this.currentAttempt,
      id: this.id,
    };

    const [callbackError] = await mightThrow(
      Promise.resolve().then(() => onFailedAttempt(context)),
    );

    if (callbackError) throw error;
  }

  private calculateDelay(attempt: number) {
    // exponential backoff with "Full Jitter" algorithm
    const { baseDelay, multiplier, maxDelay } = this.backoff;

    const deltaTime = baseDelay * multiplier ** attempt;
    const minDeltaTime = Math.min(deltaTime, maxDelay);
    return Math.round(Math.random() * (minDeltaTime + 1));
  }

  private async runDelay(delay: number) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
