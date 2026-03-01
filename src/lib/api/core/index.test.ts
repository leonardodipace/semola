import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { Middleware } from "../middleware/index.js";
import { Api } from "./index.js";

// Global server reference for cleanup
let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("Api Core", () => {
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
});
