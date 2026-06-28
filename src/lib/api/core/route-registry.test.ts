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

  test("maps bare handler JSON primitives to responses", async () => {
    const registry = new RouteRegistry({});

    registry.addRoute({
      path: "/flag",
      method: "GET",
      handler: () => false,
    });

    registry.addRoute({
      path: "/count",
      method: "GET",
      handler: () => 42,
    });

    registry.addRoute({
      path: "/empty",
      method: "GET",
      handler: () => null,
    });

    const routes = registry.buildRoutes({
      validation: { input: false, output: false },
    });

    const flagReq = new Request("http://localhost/flag") as Bun.BunRequest;
    const countReq = new Request("http://localhost/count") as Bun.BunRequest;
    const emptyReq = new Request("http://localhost/empty") as Bun.BunRequest;

    const flagRes = await routes["/flag"]?.GET?.(
      flagReq,
      {} as Bun.Server<unknown>,
    );
    const countRes = await routes["/count"]?.GET?.(
      countReq,
      {} as Bun.Server<unknown>,
    );
    const emptyRes = await routes["/empty"]?.GET?.(
      emptyReq,
      {} as Bun.Server<unknown>,
    );

    expect(await flagRes?.json()).toBe(false);
    expect(await countRes?.json()).toBe(42);
    expect(await emptyRes?.json()).toBe(null);
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
