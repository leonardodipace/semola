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

  test("keeps middleware extension return objects unchanged", async () => {
    const authData = { user: { role: "admin" } };
    const auth = new Middleware({
      handler: () => authData,
    });
    const label = new Middleware({
      handler: (c) => ({ label: (c.get("user") as { role: string }).role }),
    });

    const pipeline = new RequestPipeline({
      middlewares: [auth, label],
      validateInput: true,
      validateOutput: false,
      handler: (c) =>
        c.json(200, {
          role: (c.get("user") as { role: string }).role,
          label: c.get("label"),
        }),
    });

    const req = new Request("http://localhost/me") as Bun.BunRequest;
    const res = await pipeline.handle(req);

    expect(await res.json()).toEqual({ role: "admin", label: "admin" });
    expect(authData).toEqual({ user: { role: "admin" } });
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

  test("keeps body cache scoped to one request", async () => {
    const bodyMiddleware = new Middleware({
      request: { body: z.object({ name: z.string() }) },
      handler: (c) => ({ name: c.req.body.name }),
    });

    const pipeline = new RequestPipeline({
      middlewares: [bodyMiddleware],
      routeRequest: { body: z.object({ age: z.number() }) },
      validateInput: true,
      validateOutput: false,
      handler: (c) =>
        c.json(200, {
          name: c.get("name"),
          age: (c.req.body as { age: number }).age,
        }),
    });

    const first = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: 30 }),
    }) as Bun.BunRequest;
    const second = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", age: 40 }),
    }) as Bun.BunRequest;

    const firstRes = await pipeline.handle(first);
    const secondRes = await pipeline.handle(second);

    expect(await firstRes.json()).toEqual({ name: "Alice", age: 30 });
    expect(await secondRes.json()).toEqual({ name: "Bob", age: 40 });
  });
});
