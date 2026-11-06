import { afterAll, describe, expect, test } from "bun:test";
import { Redis } from "ioredis";
import { createClient } from "redis";
import { Cache } from "../cache/index.js";
import { PubSub } from "../pubsub/index.js";
import { Queue } from "../queue/index.js";
import { defineWorkflow, listWorkflows } from "../workflow/index.js";
import { fromIoredis, fromNodeRedis } from "./index.js";
import type { RedisAdapter } from "./types.js";

const SEMOLA_REDIS_URL = process.env.SEMOLA_REDIS_URL;

type Connect = () => Promise<RedisAdapter>;

const closers: (() => unknown)[] = [];

const connectIoredis: Connect = async () => {
  const client = new Redis(SEMOLA_REDIS_URL ?? "");

  closers.push(() => client.disconnect());

  return fromIoredis(client);
};

const connectNodeRedis: Connect = async () => {
  const client = createClient({ url: SEMOLA_REDIS_URL });

  closers.push(() => client.destroy());
  await client.connect();

  return fromNodeRedis(client);
};

const connectBun: Connect = async () => {
  const client = new Bun.RedisClient(SEMOLA_REDIS_URL);

  closers.push(() => client.close());

  return client;
};

afterAll(() => {
  for (const close of closers.splice(0)) close();
});

const clients = [
  ["Bun.RedisClient", connectBun],
  ["ioredis", connectIoredis],
  ["node-redis", connectNodeRedis],
] as const;

describe.skipIf(!SEMOLA_REDIS_URL)("Semola modules on every client", () => {
  for (const [name, connect] of clients) {
    describe(name, () => {
      test("cache sets, reads and deletes", async () => {
        const cache = new Cache<{ count: number }>({
          redis: await connect(),
          prefix: `semola:${crypto.randomUUID()}`,
          ttl: 10_000,
        });

        await cache.set("key", { count: 1 });

        expect(await cache.get("key")).toEqual({ count: 1 });
        expect(await cache.delete("key")).toBe(1);
      });

      test("pubsub delivers a published message", async () => {
        const options = {
          publisher: await connect(),
          subscriber: await connect(),
          channel: `semola:${crypto.randomUUID()}`,
        };
        const events = new PubSub<{ hello: string }>(options);
        const received = Promise.withResolvers<{ hello: string }>();

        await events.subscribe(received.resolve);
        await events.publish({ hello: "world" });

        expect(await received.promise).toEqual({ hello: "world" });

        await events.unsubscribe();
      });

      test("queue processes an enqueued job", async () => {
        const processed = Promise.withResolvers<{ id: number }>();
        const queue = new Queue<{ id: number }>({
          name: `semola-${crypto.randomUUID()}`,
          redis: await connect(),
          handler: processed.resolve,
          pollInterval: 10,
        });

        await queue.enqueue({ id: 7 });

        expect(await processed.promise).toEqual({ id: 7 });

        await queue.stop();
      });

      test("workflow runs to completion and is listed", async () => {
        const redis = await connect();
        const workflow = defineWorkflow({
          name: `semola-${crypto.randomUUID()}`,
          redis,
          pollInterval: 10,
          handler: async ({ step }) => step("answer", async () => 42),
        });

        const run = await workflow.startSync({});
        const listed = await listWorkflows(redis, { name: workflow.name });

        expect(run.status).toBe("completed");
        expect(run.result).toBe(42);
        expect(listed.map((item) => item.status)).toEqual(["completed"]);

        await workflow.stop();
      });
    });
  }
});
