import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { MessageHandler, PubSubOptions } from "./types.js";

export class PubSub<T> {
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
      return err("SerializationError", "Unable to serialize message");
    }

    const [publishError, count] = await mightThrow(
      this.options.publisher.publish(this.options.channel, stringified),
    );

    if (publishError) {
      return err(
        "PublishError",
        `Unable to publish to ${this.options.channel}`,
      );
    }

    return ok(count);
  }

  public async subscribe(handler: MessageHandler<T>) {
    if (this.isSubscribed) {
      return err("SubscribeError", "Already subscribed");
    }

    const wrappedHandler = async (message: string, channel: string) => {
      const [parseError, parsed] = mightThrowSync(() => JSON.parse(message));

      if (parseError) return;

      await mightThrow(Promise.resolve(handler(parsed as T, channel)));
    };

    const [subscribeError] = await mightThrow(
      this.options.subscriber.subscribe(this.options.channel, wrappedHandler),
    );

    if (subscribeError) {
      return err(
        "SubscribeError",
        `Unable to subscribe to ${this.options.channel}`,
      );
    }

    this.isSubscribed = true;

    return ok(undefined);
  }

  public async unsubscribe() {
    if (!this.isSubscribed) {
      return err("UnsubscribeError", "Not subscribed");
    }

    const [unsubscribeError] = await mightThrow(
      this.options.subscriber.unsubscribe(this.options.channel),
    );

    if (unsubscribeError) {
      return err(
        "UnsubscribeError",
        `Unable to unsubscribe from ${this.options.channel}`,
      );
    }

    this.isSubscribed = false;

    return ok(undefined);
  }

  public isActive() {
    return this.isSubscribed;
  }
}
