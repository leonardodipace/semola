import { describe, expect, test } from "bun:test";
import { readHash } from "./reply.js";

describe("readHash", () => {
  test("reads the hash through a Lua HGETALL", async () => {
    const sent: string[][] = [];
    const redis = {
      send: async (command: string, args: string[]) => {
        sent.push([command, ...args]);

        return ["status", "pending", "name", "wf"];
      },
    };

    expect(await readHash(redis, "meta")).toEqual({
      status: "pending",
      name: "wf",
    });
    expect(sent).toEqual([
      ["EVAL", "return redis.call('HGETALL', KEYS[1])", "1", "meta"],
    ]);
  });

  test("reads a missing hash as an empty record", async () => {
    const redis = { send: async () => [] };

    expect(await readHash(redis, "meta")).toEqual({});
  });

  test("keeps a field named __proto__ as data", async () => {
    const redis = { send: async () => ["__proto__", "x"] };
    const record = await readHash(redis, "meta");

    expect(Object.hasOwn(record, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
