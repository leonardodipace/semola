// What Semola's Redis modules call; Bun.RedisClient fits as-is.
export type RedisClient = {
  send(command: string, args: string[]): Promise<unknown>;
};

export type RedisListener = (
  message: string,
  channel: string,
) => void | Promise<void>;

// Bun-style: one listener per call; the server subscription is shared per channel.
export type RedisSubscriber = {
  subscribe(channel: string, listener: RedisListener): Promise<unknown>;
  unsubscribe(channel: string, listener: RedisListener): Promise<unknown>;
};

export type RedisAdapter = RedisClient & RedisSubscriber;

export type RedisDispatch = (channel: string, message: string) => void;

// A client that subscribes per channel and pushes every message to one dispatch.
export type RedisConnection = RedisClient & {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
};

export type IoredisClient = {
  call(command: string, ...args: string[]): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: "message", handler: RedisDispatch): unknown;
};

// node-redis (`redis` package) v4 and later.
export type NodeRedisClient = {
  sendCommand(args: string[]): Promise<unknown>;
  subscribe(channel: string, listener: RedisListener): Promise<unknown>;
  unsubscribe(channel: string, listener: RedisListener): Promise<unknown>;
};

export type ValkeyGlideMessage = {
  message: unknown;
  channel: unknown;
};

// Valkey GLIDE (`@valkey/valkey-glide`) standalone client.
export type ValkeyGlideClient = {
  customCommand(args: string[]): Promise<unknown>;
  subscribe(channels: Iterable<string>, timeoutMs: number): Promise<unknown>;
  unsubscribe(channels: Iterable<string>, timeoutMs: number): Promise<unknown>;
  getPubSubMessage(): Promise<ValkeyGlideMessage>;
};
