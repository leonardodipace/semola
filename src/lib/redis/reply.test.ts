import { describe, expect, test } from "bun:test";
import { readHash } from "./reply.js";

describe("readHash", () => {
  test("reads a RESP3 map reply as a record", async () => {
    const redis = { send: async () => ({ status: "pending" }) };

    expect(await readHash(redis, "meta")).toEqual({ status: "pending" });
  });

  test("reads a RESP2 flat field/value reply as a record", async () => {
    const redis = { send: async () => ["status", "pending", "name", "wf"] };

    expect(await readHash(redis, "meta")).toEqual({
      status: "pending",
      name: "wf",
    });
  });

  test("reads a Map reply as a record", async () => {
    const redis = { send: async () => new Map([["status", "pending"]]) };

    expect(await readHash(redis, "meta")).toEqual({ status: "pending" });
  });

  test("reads a missing hash as an empty record", async () => {
    const redis = { send: async () => [] };

    expect(await readHash(redis, "meta")).toEqual({});
  });

  test("reads a null reply as an empty record", async () => {
    const redis = { send: async () => null };

    expect(await readHash(redis, "meta")).toEqual({});
  });
});
