import { afterAll, describe, expect, test } from "bun:test";
import {
  closeClients,
  connectIoredis,
  SEMOLA_REDIS_URL,
  server,
  subscriberTests,
} from "./integration-helpers.js";
import type { RedisClient } from "./types.js";

afterAll(closeClients);

const scanAll = async (redis: RedisClient, options: string[]) => {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [next, batch] = (await redis.send("SCAN", [cursor, ...options])) as [
      string,
      string[],
    ];

    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== "0");

  return keys.sort();
};

describe.skipIf(!SEMOLA_REDIS_URL)("fromIoredis", () => {
  subscriberTests(connectIoredis());
});

describe.skipIf(!SEMOLA_REDIS_URL)("fromIoredis keyPrefix", () => {
  // Read as a glob, the prefix would match the decoy's keys and miss its own.
  const id = crypto.randomUUID();
  const prefix = `semola:${id}[*]:`;
  const decoyPrefix = `semola:${id}*:`;

  const connect = async () => {
    await server().send("SET", [`${prefix}one`, "1", "PX", "10000"]);
    await server().send("SET", [`${prefix}two`, "2", "PX", "10000"]);
    await server().send("SET", [`${decoyPrefix}one`, "x", "PX", "10000"]);

    return connectIoredis({ keyPrefix: prefix })();
  };

  test("prefixes key arguments", async () => {
    const redis = await connect();

    expect(await redis.send("GET", ["one"])).toBe("1");
  });

  test("scans only keys under the prefix and returns them without it", async () => {
    const redis = await connect();

    expect(await scanAll(redis, ["MATCH", "o*", "COUNT", "1000"])).toEqual([
      "one",
    ]);
    expect(await scanAll(redis, ["COUNT", "1000"])).toEqual(["one", "two"]);
  });

  test("prefixes every MATCH pattern", async () => {
    const redis = await connect();

    expect(await scanAll(redis, ["match", "x*", "MATCH", "t*"])).toEqual([
      "two",
    ]);
  });
});
