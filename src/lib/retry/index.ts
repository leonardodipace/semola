import { EventEmitter } from "node:events";
import { mightThrow } from "../errors/index.js";
import type {
  OnFailedAttemptContextType,
  RetryContext,
  RetryFnType,
  RetryOptions,
} from "./types.js";

const SemolaEventName = {
  start: "semola-retry-start",
  continue: "semola-retry-continue",
} as const;

const BASE_BACKOFF_DELAY = 1000;
const MAX_BACKOFF_DELAY = 1000 * 60; // 1 minute
const BACKOFF_MULTIPLIER = 2;

class SemolaStartRetryEmitter extends EventEmitter {}
class SemolaContinueRetryEmitter extends EventEmitter {}

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
    const { maxAttempts } = this.options;
    const onRetryErrorResult = this.runOnRetryError(ctx.error, this.id);
    const hasMoreAttempts = this.currentAttempt < maxAttempts;
    const canRetry = hasMoreAttempts && onRetryErrorResult;

    if (canRetry) {
      const delay = this.calculateDelay(this.currentAttempt);

      if (this.options.onFailedAttempt) {
        const context: OnFailedAttemptContextType = {
          attemptNumber: this.currentAttempt + 1,
          delay,
          error: ctx.error,
          retriesLeft: maxAttempts - this.currentAttempt,
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

  public reset() {
    this.currentAttempt = 0;
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

export function createRetry(fn: RetryFnType, options: RetryOptions) {
  const retry = new Retry(options);
  const startEmitter = new SemolaStartRetryEmitter();
  const continueEmitter = new SemolaContinueRetryEmitter();

  return () => {
    const retryFn = async () => {
      const [err] = await mightThrow(Promise.resolve().then(() => fn()));
      if (!err) {
        retry.reset();
        return;
      }

      const shouldContinue = await retry.update({ error: err });
      if (!shouldContinue) throw err;

      continueEmitter.emit(SemolaEventName.continue);
    };

    startEmitter.once(SemolaEventName.start, async () => {
      await retryFn();
    });

    continueEmitter.on(SemolaEventName.continue, async () => {
      await retryFn();
    });

    startEmitter.emit(SemolaEventName.start);
  };
}
