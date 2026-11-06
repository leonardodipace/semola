import { describe, expect, test } from "bun:test";
import { createRedisAdapter } from "./adapter.js";
import type { RedisClientSpec, RedisDispatch } from "./types.js";

type FakeClient = {
  log: string[];
  dispatch: RedisDispatch | null;
};

const spec: RedisClientSpec<FakeClient> = {
  send: async (client, command, args) => {
    client.log.push(`send:${command}:${args.join(",")}`);

    return "reply";
  },
  listen: (client, dispatch) => {
    client.log.push("listen");
    client.dispatch = dispatch;
  },
  subscribe: async (client, channel) => {
    client.log.push(`subscribe:${channel}`);
  },
  unsubscribe: async (client, channel) => {
    client.log.push(`unsubscribe:${channel}`);
  },
};

const createClient = (): FakeClient => ({ log: [], dispatch: null });

describe("createRedisAdapter", () => {
  test("sends commands through the spec", async () => {
    const client = createClient();
    const redis = createRedisAdapter(spec, client);

    expect(await redis.send("GET", ["k"])).toBe("reply");
    expect(client.log).toEqual(["send:GET:k"]);
  });

  test("listens once, before the first subscribe", async () => {
    const client = createClient();
    const redis = createRedisAdapter(spec, client);

    await redis.subscribe("a", () => {});
    await redis.subscribe("b", () => {});

    expect(client.log).toEqual(["listen", "subscribe:a", "subscribe:b"]);
  });

  test("does not listen until something subscribes", async () => {
    const client = createClient();
    const redis = createRedisAdapter(spec, client);

    await redis.send("PING", []);

    expect(client.log).toEqual(["send:PING:"]);
  });

  test("routes dispatched messages to channel listeners", async () => {
    const client = createClient();
    const redis = createRedisAdapter(spec, client);
    const received: string[] = [];

    await redis.subscribe("a", (message, channel) => {
      received.push(`${channel}:${message}`);
    });

    client.dispatch?.("a", "hello");
    client.dispatch?.("b", "ignored");
    await Bun.sleep(0);

    expect(received).toEqual(["a:hello"]);
  });

  test("works without a listen step", async () => {
    const client = createClient();
    const redis = createRedisAdapter({ ...spec, listen: undefined }, client);

    expect(await redis.subscribe("a", () => {})).toBe(1);
    expect(client.log).toEqual(["subscribe:a"]);
  });
});
