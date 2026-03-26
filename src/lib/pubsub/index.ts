import { mightThrow, mightThrowSync } from "../errors/index.js";
import type { MessageHandler, PubSubOptions } from "./types.js";

export class PubSub<T extends Record<string, unknown>> {
  private options: PubSubOptions;
  private isSubscribed = false;

  public constructor(options: PubSubOptions) {
    this.options = options;
  }

  public async publish(message: T) {
    const [stringifyError, stringified] = mightThrowSync(() =>
      JSON.stringify(message),
    );

    if (stringifyError || !stringified) {
      throw this.createError(
        "SerializationError",
        "Unable to serialize message",
      );
    }

    const [publishError, count] = await mightThrow(
      this.options.publisher.publish(this.options.channel, stringified),
    );

    if (publishError) {
      throw this.createError(
        "PublishError",
        `Unable to publish to ${this.options.channel}`,
      );
    }

    return count;
  }

  public async subscribe(handler: MessageHandler<T>) {
    if (this.isActive()) {
      throw this.createError("SubscribeError", "Already subscribed");
    }

    this.isSubscribed = true;

    const wrappedHandler = async (message: string, channel: string) => {
      const [parseError, parsed] = mightThrowSync<T>(() => JSON.parse(message));

      if (parseError) return;
      if (!parsed) return;

      await mightThrow(Promise.resolve(handler(parsed, channel)));
    };

    const [subscribeError, count] = await mightThrow(
      this.options.subscriber.subscribe(this.options.channel, wrappedHandler),
    );

    if (subscribeError) {
      this.isSubscribed = false;

      throw this.createError(
        "SubscribeError",
        `Unable to subscribe to ${this.options.channel}`,
      );
    }

    return count;
  }

  public async unsubscribe() {
    if (!this.isActive()) {
      throw this.createError("UnsubscribeError", "Not subscribed");
    }

    this.isSubscribed = false;

    const [unsubscribeError] = await mightThrow(
      this.options.subscriber.unsubscribe(this.options.channel),
    );

    if (unsubscribeError) {
      this.isSubscribed = true;

      throw this.createError(
        "UnsubscribeError",
        `Unable to unsubscribe from ${this.options.channel}`,
      );
    }

    return true;
  }

  public isActive() {
    return this.isSubscribed;
  }

  private createError(type: string, message: string) {
    const error = new Error(message);
    error.name = type;
    return error;
  }
}
