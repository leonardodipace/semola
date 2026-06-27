import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Middleware } from "../middleware/index.js";
import { RequestPipeline } from "./request-pipeline.js";

describe("RequestPipeline", () => {
  test("runs handler after middleware extensions", async () => {
    const auth = new Middleware({
      handler: () => ({ user: { role: "admin" } }),
    });

    const pipeline = new RequestPipeline({
      middlewares: [auth],
      validateInput: true,
      validateOutput: false,
      handler: (c) =>
        c.json(200, { role: (c.get("user") as { role: string }).role }),
    });

    const req = new Request("http://localhost/me") as Bun.BunRequest;
    const res = await pipeline.handle(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "admin" });
  });

  test("short-circuits when middleware returns Response", async () => {
    const guard = new Middleware({
      handler: (c) => c.json(403, { error: "Forbidden" }),
    });

    const pipeline = new RequestPipeline({
      middlewares: [guard],
      validateInput: true,
      validateOutput: false,
      handler: () => new Response("unreachable"),
    });

    const req = new Request("http://localhost/secret") as Bun.BunRequest;
    const res = await pipeline.handle(req);

    expect(res.status).toBe(403);
  });

  test("returns 400 when route validation fails", async () => {
    const pipeline = new RequestPipeline({
      middlewares: [],
      routeRequest: { body: z.object({ name: z.string() }) },
      validateInput: true,
      validateOutput: false,
      handler: (c) => c.json(200, c.req.body),
    });

    const req = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    }) as Bun.BunRequest;

    const res = await pipeline.handle(req);
    expect(res.status).toBe(400);
  });

  test("skips input validation when disabled", async () => {
    const pipeline = new RequestPipeline({
      middlewares: [],
      routeRequest: { body: z.object({ name: z.string() }) },
      validateInput: false,
      validateOutput: false,
      handler: (c) => c.json(200, { ok: true }),
    });

    const req = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    }) as Bun.BunRequest;

    const res = await pipeline.handle(req);
    expect(res.status).toBe(200);
  });

  test("validates output when enabled", async () => {
    const pipeline = new RequestPipeline({
      middlewares: [],
      routeResponse: { 200: z.object({ name: z.string() }) },
      validateInput: false,
      validateOutput: true,
      handler: (c) => c.json(200, { name: 123 } as unknown as { name: string }),
    });

    const req = new Request("http://localhost/user") as Bun.BunRequest;
    const res = await pipeline.handle(req);

    expect(res.status).toBe(400);
  });
});
