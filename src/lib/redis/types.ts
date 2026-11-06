// What Semola's Redis modules call; Bun.RedisClient fits as-is.
export type RedisClient = {
  send(command: string, args: string[]): Promise<unknown>;
};

export type RedisListener = (
  message: string,
  channel: string,
) => void | Promise<void>;

// Bun-style: subscribe resolves to the number of subscribed channels.
export type RedisSubscriber = {
  subscribe(channel: string, listener: RedisListener): Promise<number>;
  unsubscribe(channel: string, listener: RedisListener): Promise<void>;
};

export type RedisAdapter = RedisClient & RedisSubscriber;

export type RedisDispatch = (channel: string, message: string) => void;

export type ChannelConnection = {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
};

// What differs between clients; createRedisAdapter does the rest.
export type RedisClientSpec<TClient> = {
  send: (client: TClient, command: string, args: string[]) => Promise<unknown>;
  // Wires pushed messages to dispatch; runs once, before the first subscribe.
  listen?: (client: TClient, dispatch: RedisDispatch) => void;
  subscribe: (
    client: TClient,
    channel: string,
    dispatch: RedisDispatch,
  ) => Promise<unknown>;
  unsubscribe: (client: TClient, channel: string) => Promise<unknown>;
};

// ioredis and iovalkey.
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
  unsubscribe(channel: string): Promise<unknown>;
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
