import { mightThrow } from "../errors/index.js";
import type {
  ChannelConnection,
  RedisListener,
  RedisSubscriber,
} from "./types.js";

// One server subscription per channel, shared by all of its listeners.
export const createChannelSubscriber = (connection: ChannelConnection) => {
  const channels = new Map<string, Set<RedisListener>>();
  const locks = new Map<string, Promise<unknown>>();

  // Runs one subscribe/unsubscribe per channel at a time.
  const withChannelLock = <T>(channel: string, task: () => Promise<T>) => {
    const previous = locks.get(channel) ?? Promise.resolve();
    const run = previous.then(task, task);

    const release = () => {
      if (locks.get(channel) === run) locks.delete(channel);
    };

    locks.set(channel, run);
    run.then(release, release);

    return run;
  };

  const dispatch = (channel: string, message: string) => {
    const listeners = channels.get(channel);

    if (!listeners) return;

    for (const listener of listeners) {
      // Listener errors are dropped so one listener cannot break the others.
      void mightThrow(Promise.resolve().then(() => listener(message, channel)));
    }
  };

  const addListener = async (channel: string, listener: RedisListener) => {
    const listeners = channels.get(channel);

    if (listeners) {
      listeners.add(listener);

      return channels.size;
    }

    channels.set(channel, new Set([listener]));

    const [error] = await mightThrow(connection.subscribe(channel));

    if (error) {
      channels.delete(channel);

      throw error;
    }

    return channels.size;
  };

  const removeListener = async (channel: string, listener: RedisListener) => {
    const listeners = channels.get(channel);

    if (!listeners) return;
    if (!listeners.has(listener)) return;

    if (listeners.size > 1) {
      listeners.delete(listener);

      return;
    }

    // Removed only after the server confirms, so a failed unsubscribe keeps delivering.
    await connection.unsubscribe(channel);

    channels.delete(channel);
  };

  const subscriber: RedisSubscriber = {
    subscribe: (channel, listener) =>
      withChannelLock(channel, () => addListener(channel, listener)),
    unsubscribe: (channel, listener) =>
      withChannelLock(channel, () => removeListener(channel, listener)),
  };

  return { subscriber, dispatch };
};
