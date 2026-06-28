import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { RouteRegistry } from "./route-registry.js";

describe("RouteRegistry", () => {
  test("stores and returns routes", () => {
    const registry = new RouteRegistry({ prefix: "/api" });

    registry.addRoute({
      path: "/hello",
      method: "GET",
      handler: (c) => c.text(200, "ok"),
    });

    expect(registry.getRoutes()).toHaveLength(1);
    expect(registry.getRoutes()[0]?.path).toBe("/hello");
  });

  test("builds prefixed route handlers", async () => {
    const registry = new RouteRegistry({ prefix: "/api/v1" });

    registry.addRoute({
      path: "/status",
      method: "GET",
      handler: (c) => c.text(200, "ok"),
    });

    const routes = registry.buildRoutes({
      validation: { input: true, output: true },
    });

    const handler = routes["/api/v1/status"]?.GET;

    expect(handler).toBeDefined();

    const req = new Request("http://localhost/api/v1/status") as Bun.BunRequest;
    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("ok");
  });

  test("registers multiple methods on the same path", () => {
    const registry = new RouteRegistry({});

    registry.addRoute({
      path: "/resource",
      method: "GET",
      handler: (c) => c.json(200, { method: "GET" }),
    });

    registry.addRoute({
      path: "/resource",
      method: "POST",
      handler: (c) => c.json(200, { method: "POST" }),
    });

    const routes = registry.buildRoutes({
      validation: { input: true, output: true },
    });

    expect(routes["/resource"]?.GET).toBeDefined();
    expect(routes["/resource"]?.POST).toBeDefined();
  });

  test("validates bare handler request schemas", async () => {
    const registry = new RouteRegistry({});

    registry.addRoute({
      path: "/user",
      method: "POST",
      request: { body: z.object({ name: z.string() }) },
      handler: () => "ok",
    });

    const routes = registry.buildRoutes({
      validation: { input: true, output: true },
    });

    const handler = routes["/user"]?.POST;
    const req = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    }) as Bun.BunRequest;

    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(400);
  });

  test("bare handler runs per request not at build time", async () => {
    let calls = 0;
    const registry = new RouteRegistry({});

    registry.addRoute({
      path: "/counter",
      method: "GET",
      handler: () => ({ count: ++calls }),
    });

    const routes = registry.buildRoutes({
      validation: { input: false, output: false },
    });

    expect(calls).toBe(0);

    const handler = routes["/counter"]?.GET;
    const req = new Request("http://localhost/counter") as Bun.BunRequest;

    const res1 = await handler?.(req, {} as Bun.Server<unknown>);
    expect(await res1?.json()).toEqual({ count: 1 });

    const res2 = await handler?.(req, {} as Bun.Server<unknown>);
    expect(await res2?.json()).toEqual({ count: 2 });
  });

  test("validates bare handler response schemas", async () => {
    const registry = new RouteRegistry({});

    registry.addRoute({
      path: "/user",
      method: "GET",
      response: { 200: z.object({ name: z.string() }) },
      handler: () => ({ name: 123 }),
    });

    const routes = registry.buildRoutes({
      validation: { input: true, output: true },
    });

    const handler = routes["/user"]?.GET;
    const req = new Request("http://localhost/user") as Bun.BunRequest;
    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(400);
  });

  test("validates bare handler response by status code", async () => {
    const registry = new RouteRegistry({});

    registry.addRoute({
      path: "/item",
      method: "POST",
      response: { 201: z.object({ id: z.number() }) },
      handler: () => Response.json({ id: "bad" }, { status: 201 }),
    });

    const routes = registry.buildRoutes({
      validation: { input: true, output: true },
    });

    const handler = routes["/item"]?.POST;
    const req = new Request("http://localhost/item", {
      method: "POST",
    }) as Bun.BunRequest;
    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(400);
  });
});
