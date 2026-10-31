import { mightThrow } from "../errors/index.js";
import type {
  IoredisClient,
  RedisClient,
  RedisSubscribeListener,
} from "./types.js";

type BridgeEntry = {
  channel: string;
  bridge: (channel: string, message: string) => void;
};

/** Shared subscribe counts so one connection stays subscribed while any adapter needs the channel. */
const channelRefs = new WeakMap<IoredisClient, Map<string, number>>();

const channelRefCount = (client: IoredisClient, channel: string) => {
  return channelRefs.get(client)?.get(channel) ?? 0;
};

const addChannelRef = (client: IoredisClient, channel: string) => {
  let channels = channelRefs.get(client);

  if (!channels) {
    channels = new Map();
    channelRefs.set(client, channels);
  }

  const next = channelRefCount(client, channel) + 1;

  channels.set(channel, next);

  return next;
};

const removeChannelRef = (client: IoredisClient, channel: string) => {
  const channels = channelRefs.get(client);

  if (!channels) return 0;

  const next = channelRefCount(client, channel) - 1;

  if (next <= 0) {
    channels.delete(channel);

    return 0;
  }

  channels.set(channel, next);

  return next;
};

/** Bridges ioredis `message` events to Bun-style `subscribe(channel, listener)`. */
export class IoredisRedisAdapter implements RedisClient {
  private bridges = new Map<RedisSubscribeListener, BridgeEntry>();

  public constructor(private readonly client: IoredisClient) {}

  public publish(channel: string, message: string) {
    return this.client.publish(channel, message);
  }

  public async subscribe(channel: string, listener: RedisSubscribeListener) {
    const bridge = (ch: string, message: string) => {
      if (ch !== channel) return;

      void listener(message, ch);
    };

    this.bridges.set(listener, { channel, bridge });
    this.client.on("message", bridge);

    const refs = addChannelRef(this.client, channel);

    if (refs > 1) {
      return undefined;
    }

    const [error] = await mightThrow(this.client.subscribe(channel));

    if (error) {
      this.client.off("message", bridge);
      this.bridges.delete(listener);
      removeChannelRef(this.client, channel);
      throw error;
    }

    return undefined;
  }

  public async unsubscribe(channel: string, listener?: RedisSubscribeListener) {
    if (listener) {
      await this.unsubscribeListener(channel, listener);

      return;
    }

    const entries = [...this.bridges.entries()].filter(
      ([, entry]) => entry.channel === channel,
    );

    for (const [entryListener] of entries) {
      await this.unsubscribeListener(channel, entryListener);
    }
  }

  private async unsubscribeListener(
    channel: string,
    listener: RedisSubscribeListener,
  ) {
    const entry = this.bridges.get(listener);

    if (!entry) return;
    if (entry.channel !== channel) return;

    const isLastRef = channelRefCount(this.client, channel) === 1;

    if (isLastRef) {
      await this.client.unsubscribe(channel);
    }

    this.client.off("message", entry.bridge);
    this.bridges.delete(listener);
    removeChannelRef(this.client, channel);
  }
}
