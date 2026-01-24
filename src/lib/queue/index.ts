import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { Job, QueueOptions } from "./types.js";

export class Queue<T> {
  private options: QueueOptions<T>;
  private running = true;

  public constructor(options: QueueOptions<T>) {
    this.options = options;
    this.processJobs();
  }

  public async enqueue(data: T) {
    const job: Job<T> = {
      id: crypto.randomUUID(),
      data,
      attempts: 0,
      maxRetries: this.options.retries,
      createdAt: Date.now(),
    };

    const [stringifyError, serialized] = mightThrowSync(() =>
      JSON.stringify(job),
    );

    if (stringifyError) {
      return err("QueueError", "Unable to serialize job data");
    }

    if (!serialized) {
      return err("QueueError", "Unable to serialize job data");
    }

    const queueKey = `queue:${this.options.name}:jobs`;

    const [pushError] = await mightThrow(
      this.options.redis.lpush(queueKey, serialized),
    );

    if (pushError) {
      return err("QueueError", "Unable to enqueue job");
    }

    return ok(job.id);
  }

  public stop() {
    this.running = false;
  }

  private async processJobs() {
    while (this.running) {
      const queueKey = `queue:${this.options.name}:jobs`;

      const [popError, jobData] = await mightThrow(
        this.options.redis.rpop(queueKey),
      );

      if (popError) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      if (!jobData) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const [parseError, job] = mightThrowSync(
        () => JSON.parse(jobData) as Job<T>,
      );

      if (parseError || !job) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      await this.handleJob(job);
    }
  }

  private async handleJob(job: Job<T>) {
    const [handlerError] = await mightThrow(
      Promise.resolve().then(() => this.options.handler(job.data)),
    );

    if (!handlerError) {
      if (this.options.onSuccess) {
        await mightThrow(Promise.resolve(this.options.onSuccess(job)));
      }

      return;
    }

    job.attempts++;

    job.error =
      handlerError instanceof Error
        ? handlerError.message
        : String(handlerError);

    if (job.attempts < job.maxRetries) {
      await this.retryJob(job);
    } else {
      if (this.options.onError) {
        await mightThrow(Promise.resolve(this.options.onError(job)));
      }
    }
  }

  private async retryJob(job: Job<T>) {
    const delay = Math.min(1000 * 2 ** job.attempts, 60000);

    await new Promise((resolve) => setTimeout(resolve, delay));

    const [stringifyError, serialized] = mightThrowSync(() =>
      JSON.stringify(job),
    );

    if (stringifyError || !serialized) {
      return;
    }

    const queueKey = `queue:${this.options.name}:jobs`;

    await mightThrow(this.options.redis.lpush(queueKey, serialized));
  }
}
