import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Middleware } from "../middleware/index.js";
import { RouteHandlerBuilder } from "./route-handler-builder.js";

describe("RouteHandlerBuilder", () => {
  const builder = new RouteHandlerBuilder();
  const user = { name: "Alice" };

  test("builds simple route handler", async () => {
    const handler = builder.build({
      route: {
        path: "/hello",
        method: "GET",
        handler: (c) => c.json(200, { ok: true }),
      },
      globalMiddlewares: [],
      validation: { input: true, output: true },
    });

    const req = new Request("http://localhost/hello") as Bun.BunRequest;
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("builds output-validated route handler", async () => {
    const handler = builder.build({
      route: {
        path: "/user",
        method: "GET",
        response: { 200: z.object({ name: z.string() }) },
        handler: (c) => c.json(200, user),
      },
      globalMiddlewares: [],
      validation: { input: true, output: true },
    });

    const req = new Request("http://localhost/user") as Bun.BunRequest;
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(user);
  });

  test("builds body-only route handler", async () => {
    const handler = builder.build({
      route: {
        path: "/user",
        method: "POST",
        request: { body: z.object({ name: z.string() }) },
        handler: (c) => c.json(200, c.req.body),
      },
      globalMiddlewares: [],
      validation: { input: true, output: true },
    });

    const req = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    }) as Bun.BunRequest;

    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(user);
  });

  test("builds full pipeline for middleware routes", async () => {
    const auth = new Middleware({
      handler: () => ({ user: { id: 1 } }),
    });

    const handler = builder.build({
      route: {
        path: "/me",
        method: "GET",
        middlewares: [auth],
        handler: (c) => {
          const user = (c.get as (key: string) => unknown)("user") as {
            id: number;
          };

          return c.json(200, { id: user.id });
        },
      },
      globalMiddlewares: [],
      validation: { input: true, output: true },
    });

    const req = new Request("http://localhost/me") as Bun.BunRequest;
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
  });

  test("includes global middlewares in full pipeline", async () => {
    const globalAuth = new Middleware({
      handler: () => ({ token: "abc" }),
    });

    const handler = builder.build({
      route: {
        path: "/data",
        method: "GET",
        handler: (c) =>
          c.json(200, {
            token: (c.get as (key: string) => unknown)("token") as string,
          }),
      },
      globalMiddlewares: [globalAuth],
      validation: { input: true, output: true },
    });

    const req = new Request("http://localhost/data") as Bun.BunRequest;
    const res = await handler(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "abc" });
  });
});
