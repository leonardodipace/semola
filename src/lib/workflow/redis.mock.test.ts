import { describe, expect, test } from "bun:test";
import { createRedis } from "./redis.mock.js";

describe("MockRedisClient", () => {
  test("zrangebyscore orders equal scores lexicographically", async () => {
    const redis = createRedis();

    await redis.zadd("z", 1, "b-member");
    await redis.zadd("z", 1, "a-member");
    await redis.zadd("z", 0, "z-first");

    expect(await redis.zrangebyscore("z", 0, 2)).toEqual([
      "z-first",
      "a-member",
      "b-member",
    ]);
  });
});
