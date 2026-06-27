import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createContext, getEmptyValidated } from "./context-factory.js";

describe("context-factory", () => {
  test("create sets raw request", () => {
    const req = new Request("http://localhost/hello") as Bun.BunRequest;
    const context = createContext({ req });

    expect(context.raw).toBe(req);
    expect(context.req.body).toBeUndefined();
  });

  test("create wires extensions via get", () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const context = createContext({
      req,
      extensions: { user: { id: 1 } },
    });

    expect(context.get("user")).toEqual({ id: 1 });
  });

  test("create wraps json when output validation is enabled", async () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const context = createContext({
      req,
      response: { 200: z.object({ name: z.string() }) },
      validateOutput: true,
    });

    const good = await context.json(200, { name: "Alice" });
    expect(good.status).toBe(200);

    const bad = await context.json(200, { name: 123 });
    expect(bad.status).toBe(400);
  });

  test("create uses default json without output validation", async () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const context = createContext({ req });

    const res = await context.json(200, { ok: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("getEmptyValidated returns frozen defaults", () => {
    const empty = getEmptyValidated();
    expect(empty.body).toBeUndefined();
    expect(Object.isFrozen(empty)).toBe(true);
  });
});
