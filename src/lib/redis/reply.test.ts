import { afterAll, describe, expect, test } from "bun:test";
import {
  closeClients,
  SEMOLA_REDIS_URL,
  server,
  uniqueName,
} from "./integration-helpers.js";
import { readHash } from "./reply.js";

afterAll(closeClients);

describe.skipIf(!SEMOLA_REDIS_URL)("readHash", () => {
  test("reads a hash as a record", async () => {
    const key = uniqueName();

    await server().send("HSET", [key, "status", "pending", "name", "wf"]);

    expect(await readHash(server(), key)).toEqual({
      status: "pending",
      name: "wf",
    });
  });

  test("reads a missing hash as an empty record", async () => {
    expect(await readHash(server(), uniqueName())).toEqual({});
  });

  test("keeps a field named __proto__ as data", async () => {
    const key = uniqueName();

    await server().send("HSET", [key, "__proto__", "x"]);

    const record = await readHash(server(), key);

    expect(Object.hasOwn(record, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
