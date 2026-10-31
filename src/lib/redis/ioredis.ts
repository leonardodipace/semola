import type {
  IoredisClient,
  RedisClient,
  RedisSubscribeListener,
} from "./types.js";

/**
 * Adapts ioredis event subscribe to Bun-style `subscribe(channel, listener)`.
 */
export class IoredisRedisAdapter implements RedisClient {
  private bridges = new Map<
    RedisSubscribeListener,
    (channel: string, message: string) => void
  >();

  public constructor(private readonly client: IoredisClient) {}

  public publish(channel: string, message: string) {
    return this.client.publish(channel, message);
  }

  public async subscribe(channel: string, listener: RedisSubscribeListener) {
    const bridge = (ch: string, message: string) => {
      if (ch !== channel) return;

      void listener(message, ch);
    };

    this.bridges.set(listener, bridge);
    this.client.on("message", bridge);
    await this.client.subscribe(channel);

    return undefined;
  }

  public async unsubscribe(channel: string, listener?: RedisSubscribeListener) {
    if (listener) {
      const bridge = this.bridges.get(listener);

      if (bridge) {
        this.client.off("message", bridge);
        this.bridges.delete(listener);
      }
    } else {
      for (const bridge of this.bridges.values()) {
        this.client.off("message", bridge);
      }

      this.bridges.clear();
    }

    await this.client.unsubscribe(channel);
  }
}
