import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { Api } from "./api.js";
import { Middleware } from "./middleware.js";

// Global server reference for cleanup
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("Api Core", () => {
  test("should dispatch via api.fetch without server", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/users/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      handler: (c) => c.json(200, { userId: c.req.params.id }),
    });

    const res = await api.fetch(new Request("http://localhost/users/abc"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ userId: "abc" });
  });

  test("should handle a basic GET request", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/hello",
      method: "GET",
      handler: (c) => c.json(200, { message: "world" }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/hello`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "world" });
  });

  test("should reuse compiled routes across fetch calls", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/hello",
      method: "GET",
      handler: () => "ok",
    });

    const first = api.getRouteHandlers();
    const second = api.getRouteHandlers();

    expect(first).toBe(second);
    expect(first["/hello"]?.GET).toBe(second["/hello"]?.GET);

    await api.fetch(new Request("http://localhost/hello"));

    const third = api.getRouteHandlers();

    expect(third).toBe(first);
  });

  test("should map bare return handlers to responses", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/text",
      method: "GET",
      handler: () => "Hello World",
    });

    api.defineRoute({
      path: "/json",
      method: "GET",
      handler: () => ({ message: "Hello World" }),
    });

    const textRes = await api.fetch(new Request("http://localhost/text"));
    const jsonRes = await api.fetch(new Request("http://localhost/json"));

    expect(await textRes.text()).toBe("Hello World");
    expect(await jsonRes.json()).toEqual({ message: "Hello World" });
  });

  test("should normalize prefix", async () => {
    const api = new Api({
      prefix: "/api/",
    });

    api.defineRoute({
      path: "/hello",
      method: "GET",
      handler: (c) => c.json(200, { message: "world" }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/api/hello`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "world" });
  });

  test("should validate request body and return 400 on failure", async () => {
    const api = new Api();
    const schema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "POST",
      request: { body: schema },
      handler: (c) => c.json(200, c.req.body),
    });

    api.serve(0, (s) => {
      server = s;
    });

    // Invalid request
    const badRes = await fetch(`http://localhost:${server?.port}/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }), // Should be string
    });
    expect(badRes.status).toBe(400);

    // Valid request
    const goodRes = await fetch(`http://localhost:${server?.port}/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(goodRes.status).toBe(200);
    const body = await goodRes.json();
    expect(body).toEqual({ name: "Alice" });
  });

  test("should validate text request body", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/message",
      method: "POST",
      request: { body: z.string() },
      handler: (c) => c.text(200, c.req.body),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  test("should extract and validate path parameters", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/users/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      handler: (c) => c.json(200, { userId: c.req.params.id }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/users/abc`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ userId: "abc" });
  });

  test("should execute middleware and share data via context", async () => {
    const auth = new Middleware({
      handler: () => ({ user: { id: 1, role: "admin" } }),
    });

    const api = new Api({ middlewares: [auth] as const });

    api.defineRoute({
      path: "/me",
      method: "GET",
      handler: (c) => {
        const user = c.get("user");
        return c.json(200, { role: user.role });
      },
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/me`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ role: "admin" });
  });

  test("should short-circuit when middleware returns a Response", async () => {
    const guard = new Middleware({
      handler: (c) => c.json(403, { error: "Forbidden" }),
    });

    const api = new Api();

    api.defineRoute({
      path: "/secret",
      method: "GET",
      middlewares: [guard],
      handler: () => new Response("Should not be reached"),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/secret`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  test("should respect URL prefixing", async () => {
    const api = new Api({ prefix: "/api/v1" });

    api.defineRoute({
      path: "/status",
      method: "GET",
      handler: (c) => c.text(200, "ok"),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/api/v1/status`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("should return 404 for non-existent routes", async () => {
    const api = new Api();
    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/nowhere`);
    expect(res.status).toBe(404);
  });

  test("should validate body in both middleware and route handler", async () => {
    const bodySchema = z.object({ name: z.string(), age: z.number() });

    const validateBodyMiddleware = new Middleware({
      request: { body: z.object({ name: z.string() }) },
      handler: (c) => ({ validatedName: c.req.body.name }),
    });

    const api = new Api();

    api.defineRoute({
      path: "/user",
      method: "POST",
      middlewares: [validateBodyMiddleware] as const,
      request: { body: bodySchema },
      handler: (c) => {
        const validatedName = c.get("validatedName");
        return c.json(200, {
          fromMiddleware: validatedName,
          fromRoute: c.req.body,
        });
      },
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: 30 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      fromMiddleware: "Alice",
      fromRoute: { name: "Alice", age: 30 },
    });
  });

  test("should validate body across multiple middlewares", async () => {
    const mw1 = new Middleware({
      request: { body: z.object({ a: z.string() }) },
      handler: (c) => ({ fieldA: c.req.body.a }),
    });

    const mw2 = new Middleware({
      request: { body: z.object({ b: z.number() }) },
      handler: (c) => ({ fieldB: c.req.body.b }),
    });

    const api = new Api();

    api.defineRoute({
      path: "/multi",
      method: "POST",
      middlewares: [mw1, mw2] as const,
      handler: (c) => {
        return c.json(200, {
          a: c.get("fieldA"),
          b: c.get("fieldB"),
        });
      },
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/multi`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: "hello", b: 42 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ a: "hello", b: 42 });
  });

  test("should skip input validation when validation is false", async () => {
    const api = new Api({ validation: false });
    const schema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "POST",
      request: { body: schema },
      handler: (c) => c.json(200, { ok: true }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    // Invalid body should still pass since validation is disabled
    const res = await fetch(`http://localhost:${server?.port}/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });

    expect(res.status).toBe(200);
  });

  test("should skip input validation when validation.input is false", async () => {
    const api = new Api({ validation: { input: false } });
    const schema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "POST",
      request: { body: schema },
      handler: (c) => c.json(200, { ok: true }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    // Invalid body should still pass since input validation is disabled
    const res = await fetch(`http://localhost:${server?.port}/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });

    expect(res.status).toBe(200);
  });

  test("should validate output and return 400 when response schema fails", async () => {
    const api = new Api();
    const responseSchema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "GET",
      response: { 200: responseSchema },
      // Handler returns invalid output (name is a number, not string)
      handler: (c) => c.json(200, { name: 123 } as unknown as { name: string }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/user`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("message");
  });

  test("should pass output validation when response schema succeeds", async () => {
    const api = new Api();
    const responseSchema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "GET",
      response: { 200: responseSchema },
      handler: (c) => c.json(200, { name: "Alice" }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/user`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ name: "Alice" });
  });

  test("should skip output validation when validation.output is false", async () => {
    const api = new Api({ validation: { output: false } });
    const responseSchema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "GET",
      response: { 200: responseSchema },
      // Handler returns invalid output
      handler: (c) => c.json(200, { name: 123 } as unknown as { name: string }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    // Output validation is disabled, so the invalid response should pass through
    const res = await fetch(`http://localhost:${server?.port}/user`);
    expect(res.status).toBe(200);
  });

  test("should skip output validation when validation is false", async () => {
    const api = new Api({ validation: false });
    const responseSchema = z.object({ name: z.string() });

    api.defineRoute({
      path: "/user",
      method: "GET",
      response: { 200: responseSchema },
      handler: (c) => c.json(200, { name: 123 } as unknown as { name: string }),
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/user`);
    expect(res.status).toBe(200);
  });

  test("should expose OpenAPI spec from the api instance", async () => {
    const api = new Api({
      openapi: { title: "Test API", version: "2.0.0" },
    });

    api.defineRoute({
      path: "/hello",
      method: "GET",
      handler: (c) => c.json(200, { ok: true }),
    });

    const spec = await api.getOpenApiSpec();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Test API");
    expect(spec.info.version).toBe("2.0.0");
  });

  test("registers multiple methods on the same path", () => {
    const api = new Api();

    api.defineRoute({
      path: "/resource",
      method: "GET",
      handler: (c) => c.json(200, { method: "GET" }),
    });

    api.defineRoute({
      path: "/resource",
      method: "POST",
      handler: (c) => c.json(200, { method: "POST" }),
    });

    const routes = api.getRouteHandlers();

    expect(routes["/resource"]?.GET).toBeDefined();
    expect(routes["/resource"]?.POST).toBeDefined();
  });

  test("validates bare handler request schemas via getRouteHandlers", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/user",
      method: "POST",
      request: { body: z.object({ name: z.string() }) },
      handler: () => "ok",
    });

    const handler = api.getRouteHandlers()["/user"]?.POST;
    const req = new Request("http://localhost/user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    }) as Bun.BunRequest;

    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(400);
  });

  test("maps bare handler JSON primitives to responses", async () => {
    const api = new Api({ validation: false });

    api.defineRoute({ path: "/flag", method: "GET", handler: () => false });
    api.defineRoute({ path: "/count", method: "GET", handler: () => 42 });
    api.defineRoute({ path: "/empty", method: "GET", handler: () => null });

    const routes = api.getRouteHandlers();
    const server = {} as Bun.Server<unknown>;

    const flagRes = await routes["/flag"]?.GET?.(
      new Request("http://localhost/flag") as Bun.BunRequest,
      server,
    );
    const countRes = await routes["/count"]?.GET?.(
      new Request("http://localhost/count") as Bun.BunRequest,
      server,
    );
    const emptyRes = await routes["/empty"]?.GET?.(
      new Request("http://localhost/empty") as Bun.BunRequest,
      server,
    );

    expect(await flagRes?.json()).toBe(false);
    expect(await countRes?.json()).toBe(42);
    expect(await emptyRes?.json()).toBe(null);
  });

  test("validates bare handler response schemas", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/user",
      method: "GET",
      response: { 200: z.object({ name: z.string() }) },
      handler: () => ({ name: 123 }),
    });

    const handler = api.getRouteHandlers()["/user"]?.GET;
    const req = new Request("http://localhost/user") as Bun.BunRequest;
    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(400);
  });

  test("validates bare handler response by status code", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/item",
      method: "POST",
      response: { 201: z.object({ id: z.number() }) },
      handler: () => Response.json({ id: "bad" }, { status: 201 }),
    });

    const handler = api.getRouteHandlers()["/item"]?.POST;
    const req = new Request("http://localhost/item", {
      method: "POST",
    }) as Bun.BunRequest;
    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res?.status).toBe(400);
  });

  test("returns cached Response for sync validated bare POST handler", async () => {
    const api = new Api();

    api.defineRoute({
      path: "/echo",
      method: "POST",
      request: { body: z.string() },
      response: { 200: z.string() },
      handler: () => "Hello World",
    });

    const handler = api.getRouteHandlers()["/echo"]?.POST;
    const req = new Request("http://localhost/echo", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "Hello World",
    }) as Bun.BunRequest;

    const res = await handler?.(req, {} as Bun.Server<unknown>);

    expect(res).toBeInstanceOf(Response);
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("Hello World");
  });

  test("keeps middleware extension return objects unchanged", async () => {
    const authData = { user: { role: "admin" } };
    const auth = new Middleware({ handler: () => authData });
    const label = new Middleware({
      handler: (c) => ({ label: (c.get("user") as { role: string }).role }),
    });

    const api = new Api();

    api.defineRoute({
      path: "/me",
      method: "GET",
      middlewares: [auth, label] as const,
      handler: (c) =>
        c.json(200, {
          role: (c.get("user") as { role: string }).role,
          label: c.get("label"),
        }),
    });

    const res = await api.fetch(new Request("http://localhost/me"));

    expect(await res.json()).toEqual({ role: "admin", label: "admin" });
    expect(authData).toEqual({ user: { role: "admin" } });
  });

  test("keeps body cache scoped to one request", async () => {
    const bodyMiddleware = new Middleware({
      request: { body: z.object({ name: z.string() }) },
      handler: (c) => ({ name: c.req.body.name }),
    });

    const api = new Api();

    api.defineRoute({
      path: "/user",
      method: "POST",
      middlewares: [bodyMiddleware] as const,
      request: { body: z.object({ age: z.number() }) },
      handler: (c) =>
        c.json(200, {
          name: c.get("name"),
          age: (c.req.body as { age: number }).age,
        }),
    });

    const first = await api.fetch(
      new Request("http://localhost/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", age: 30 }),
      }),
    );
    const second = await api.fetch(
      new Request("http://localhost/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob", age: 40 }),
      }),
    );

    expect(await first.json()).toEqual({ name: "Alice", age: 30 });
    expect(await second.json()).toEqual({ name: "Bob", age: 40 });
  });
});

describe("Api SSE", () => {
  test("should stream SSE events with text/event-stream content type", async () => {
    const api = new Api();

    api.defineSSERoute({
      path: "/events",
      handler: async function* () {
        yield { event: "tick", data: { n: 1 } };
        yield { data: { n: 2 }, id: "2" };
        yield { data: "done", retry: 1000 };
      },
    });

    const res = await api.fetch(new Request("http://localhost/events"));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(body).toBe(
      'event: tick\ndata: {"n":1}\n\nid: 2\ndata: {"n":2}\n\nretry: 1000\ndata: done\n\n',
    );
  });

  test("should validate request schema on SSE routes", async () => {
    const api = new Api();

    api.defineSSERoute({
      path: "/rooms/:roomId/events",
      request: {
        params: z.object({ roomId: z.string() }),
        query: z.object({ since: z.string() }),
      },
      handler: async function* (c) {
        yield {
          event: "joined",
          data: { roomId: c.req.params.roomId, since: c.req.query.since },
        };
      },
    });

    const bad = await api.fetch(
      new Request("http://localhost/rooms/abc/events"),
    );
    expect(bad.status).toBe(400);

    const good = await api.fetch(
      new Request("http://localhost/rooms/abc/events?since=0"),
    );
    expect(good.status).toBe(200);
    expect(await good.text()).toBe(
      'event: joined\ndata: {"roomId":"abc","since":"0"}\n\n',
    );
  });

  test("should expose middleware extensions via c.get on SSE routes", async () => {
    const auth = new Middleware({
      handler: () => ({ userId: "user-1" }),
    });

    const api = new Api({ middlewares: [auth] as const });

    api.defineSSERoute({
      path: "/notifications",
      handler: async function* (c) {
        yield { event: "connected", data: { userId: c.get("userId") } };
      },
    });

    const res = await api.fetch(new Request("http://localhost/notifications"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      'event: connected\ndata: {"userId":"user-1"}\n\n',
    );
  });

  test("should short-circuit SSE when middleware returns a Response", async () => {
    let handlerCalled = false;

    const guard = new Middleware({
      handler: (c) => c.json(401, { message: "Unauthorized" }),
    });

    const api = new Api();

    api.defineSSERoute({
      path: "/secret",
      middlewares: [guard],
      handler: async function* () {
        handlerCalled = true;
        yield { data: "should-not-send" };
      },
    });

    const res = await api.fetch(new Request("http://localhost/secret"));

    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).not.toBe("text/event-stream");
    expect(await res.json()).toEqual({ message: "Unauthorized" });
    expect(handlerCalled).toBe(false);
  });

  test("should call gen.return when the client disconnects", async () => {
    let cleanedUp = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = new Api();

    api.defineSSERoute({
      path: "/live",
      handler: async function* () {
        try {
          yield { data: "start" };
          await gate;
          yield { data: "never" };
        } finally {
          cleanedUp = true;
        }
      },
    });

    api.serve(0, (s) => {
      server = s;
    });

    const res = await fetch(`http://localhost:${server?.port}/live`);
    const reader = res.body?.getReader();

    expect(reader).toBeDefined();

    const first = await reader?.read();
    expect(first?.done).toBe(false);

    await reader?.cancel();
    release();
    await Bun.sleep(20);

    expect(cleanedUp).toBe(true);
  });
});
