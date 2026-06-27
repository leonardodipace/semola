import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ContextFactory } from "./context-factory.js";

describe("ContextFactory", () => {
  const factory = new ContextFactory();

  test("create sets raw request", () => {
    const req = new Request("http://localhost/hello") as Bun.BunRequest;
    const context = factory.create({ req });

    expect(context.raw).toBe(req);
    expect(context.req.body).toBeUndefined();
  });

  test("create wires extensions via get", () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const context = factory.create({
      req,
      extensions: { user: { id: 1 } },
    });

    expect(context.get("user")).toEqual({ id: 1 });
  });

  test("createWithBody shares body on req", () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const body = { name: "Alice" };
    const context = factory.createWithBody({ req, body });

    expect(context.req.body).toEqual(body);
    expect(Object.is(context.req, context)).toBe(true);
  });

  test("create wraps json when output validation is enabled", async () => {
    const req = new Request("http://localhost") as Bun.BunRequest;
    const context = factory.create({
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
    const context = factory.create({ req });

    const res = await context.json(200, { ok: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("getEmptyValidated returns frozen defaults", () => {
    const empty = factory.getEmptyValidated();
    expect(empty.body).toBeUndefined();
    expect(Object.isFrozen(empty)).toBe(true);
  });
});
