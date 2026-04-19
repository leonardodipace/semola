import { err, mightThrow, mightThrowSync, ok } from "../errors/index.js";
import type { MessageHandler, PubSubOptions } from "./types.js";

export class PubSub<T extends Record<string, unknown>> {
  private options: PubSubOptions;
  private isSubscribed = false;
  private nextHandlerId = 0;
  private handlers = new Map<number, MessageHandler<T>>();
  private unsubscribeInFlight: Promise<
    readonly [null, unknown] | readonly [unknown, null]
  > | null = null;
  private subscribeInFlight: Promise<
    readonly [null, number] | readonly [unknown, null]
  > | null = null;

  public constructor(options: PubSubOptions) {
    this.options = options;
  }

  private async onMessage(message: string, channel: string) {
    const [parseError, parsed] = mightThrowSync<T>(() => JSON.parse(message));

    if (parseError) return;
    if (!parsed) return;

    const handlers = Array.from(this.handlers.values());

    for (const handler of handlers) {
      await mightThrow(Promise.resolve().then(() => handler(parsed, channel)));
    }
  }

  private async unsubscribeHandler(handlerId: number) {
    const inFlightUnsubscribe = this.unsubscribeInFlight;

    if (inFlightUnsubscribe) {
      await inFlightUnsubscribe;
    }

    const handler = this.handlers.get(handlerId);

    if (!handler) {
      return err("UnsubscribeError", "Not subscribed");
    }

    this.handlers.delete(handlerId);

    if (this.handlers.size > 0) {
      return ok(true);
    }

    this.isSubscribed = false;

    this.unsubscribeInFlight = mightThrow(
      this.options.subscriber.unsubscribe(this.options.channel),
    );

    const unsubscribeInFlight = this.unsubscribeInFlight;

    if (!unsubscribeInFlight) {
      this.handlers.set(handlerId, handler);
      this.isSubscribed = true;

      return err(
        "UnsubscribeError",
        `Unable to unsubscribe from ${this.options.channel}`,
      );
    }

    const [unsubscribeError] = await unsubscribeInFlight;

    if (unsubscribeError) {
      this.handlers.set(handlerId, handler);
      this.isSubscribed = true;
      this.unsubscribeInFlight = null;

      return err(
        "UnsubscribeError",
        `Unable to unsubscribe from ${this.options.channel}`,
      );
    }

    this.unsubscribeInFlight = null;

    return ok(true);
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
    const inFlightUnsubscribe = this.unsubscribeInFlight;

    if (inFlightUnsubscribe) {
      await inFlightUnsubscribe;
    }

    const handlerId = this.nextHandlerId;

    this.nextHandlerId += 1;
    this.handlers.set(handlerId, handler);

    if (this.isActive()) {
      return ok(() => this.unsubscribeHandler(handlerId));
    }

    const inFlightSubscribe = this.subscribeInFlight;

    if (inFlightSubscribe) {
      const [inFlightError] = await inFlightSubscribe;

      if (inFlightError || !this.isSubscribed) {
        this.handlers.delete(handlerId);

        return err(
          "SubscribeError",
          `Unable to subscribe to ${this.options.channel}`,
        );
      }

      return ok(() => this.unsubscribeHandler(handlerId));
    }

    this.subscribeInFlight = mightThrow(
      this.options.subscriber.subscribe(
        this.options.channel,
        async (message, channel) => this.onMessage(message, channel),
      ),
    );

    const subscribeInFlight = this.subscribeInFlight;

    if (!subscribeInFlight) {
      this.handlers.delete(handlerId);

      return err(
        "SubscribeError",
        `Unable to subscribe to ${this.options.channel}`,
      );
    }

    const [subscribeError, count] = await subscribeInFlight;

    this.subscribeInFlight = null;

    if (subscribeError) {
      this.handlers.delete(handlerId);

      return err(
        "SubscribeError",
        `Unable to subscribe to ${this.options.channel}`,
      );
    }

    if (!count) {
      this.handlers.delete(handlerId);

      return err(
        "SubscribeError",
        `Unable to subscribe to ${this.options.channel}`,
      );
    }

    this.isSubscribed = true;

    return ok(() => this.unsubscribeHandler(handlerId));
  }

  public async unsubscribe() {
    const inFlightUnsubscribe = this.unsubscribeInFlight;

    if (inFlightUnsubscribe) {
      await inFlightUnsubscribe;
    }

    if (!this.isActive()) {
      return err("UnsubscribeError", "Not subscribed");
    }

    const handlers = new Map(this.handlers);

    this.handlers.clear();

    this.isSubscribed = false;

    this.unsubscribeInFlight = mightThrow(
      this.options.subscriber.unsubscribe(this.options.channel),
    );

    const unsubscribeInFlight = this.unsubscribeInFlight;

    if (!unsubscribeInFlight) {
      this.handlers = handlers;
      this.isSubscribed = true;

      return err(
        "UnsubscribeError",
        `Unable to unsubscribe from ${this.options.channel}`,
      );
    }

    const [unsubscribeError] = await unsubscribeInFlight;

    if (unsubscribeError) {
      this.handlers = handlers;
      this.isSubscribed = true;
      this.unsubscribeInFlight = null;

      return err(
        "UnsubscribeError",
        `Unable to unsubscribe from ${this.options.channel}`,
      );
    }

    this.unsubscribeInFlight = null;

    return ok(true);
  }

  public isActive() {
    return this.handlers.size > 0 && this.isSubscribed;
  }
}
