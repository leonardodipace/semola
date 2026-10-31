import { describe, expect, test } from "bun:test";
import { fromIoredis } from "./ioredis.js";
import type { ChannelHandler, IoredisLike } from "./types.js";

class FakeIoredis {
  private messageListeners = new Set<
    (channel: string, message: string) => void
  >();
  public subscribed = new Set<string>();

  public async publish(channel: string, message: string) {
    for (const listener of this.messageListeners) {
      listener(channel, message);
    }

    return this.messageListeners.size;
  }

  public async subscribe(...channels: string[]) {
    for (const channel of channels) this.subscribed.add(channel);
  }

  public async unsubscribe(...channels: string[]) {
    for (const channel of channels) this.subscribed.delete(channel);
  }

  public on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ) {
    if (event === "message") this.messageListeners.add(listener);
  }

  public off(
    event: "message",
    listener: (channel: string, message: string) => void,
  ) {
    if (event === "message") this.messageListeners.delete(listener);
  }
}

describe("fromIoredis", () => {
  test("routes message events to Bun-style listeners", async () => {
    const raw = new FakeIoredis();
    const redis = fromIoredis(raw as unknown as IoredisLike);
    const seen: string[] = [];
    const handler: ChannelHandler = (message) => {
      seen.push(message);
    };

    await redis.subscribe("ch", handler);
    await raw.publish("ch", "hello");
    await raw.publish("other", "skip");

    expect(seen).toEqual(["hello"]);
    expect(raw.subscribed.has("ch")).toBe(true);

    await redis.unsubscribe("ch", handler);
    await raw.publish("ch", "again");

    expect(seen).toEqual(["hello"]);
    expect(raw.subscribed.has("ch")).toBe(false);
  });
});
