import { describe, expect, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";
import { SchemaConfigError } from "./errors.js";
import { Middleware } from "./middleware.js";
import {
  applyHeaders,
  badRequest,
  bodyHasMultipleReaders,
  createContext,
  emptyValidated,
  getFullPath,
  html,
  json,
  mapValidationError,
  redirect,
  resolveValidation,
  text,
  validatingJson,
} from "./runtime.js";

describe("runtime", () => {
  describe("context", () => {
    test("create sets raw request", () => {
      const req = new Request("http://localhost/hello") as Bun.BunRequest;
      const context = createContext(req);

      expect(context.raw).toBe(req);
      expect(context.req.body).toBeUndefined();
    });

    test("create wires extensions via get", () => {
      const req = new Request("http://localhost") as Bun.BunRequest;
      const extensions = { user: { id: 1 } };
      const context = createContext(req, undefined, (key) => {
        return extensions[key as keyof typeof extensions];
      });

      expect(context.get("user")).toEqual({ id: 1 });
    });

    test("create wraps json when output validation is enabled", async () => {
      const req = new Request("http://localhost") as Bun.BunRequest;
      const jsonHandler = validatingJson({
        200: z.object({ name: z.string() }),
      });
      const context = createContext(req, undefined, undefined, jsonHandler);

      const good = await context.json(200, { name: "Alice" });
      expect(good.status).toBe(200);

      const bad = await context.json(200, { name: 123 });
      expect(bad.status).toBe(400);
    });

    test("create uses default json without output validation", async () => {
      const req = new Request("http://localhost") as Bun.BunRequest;
      const context = createContext(req);

      const res = await context.json(200, { ok: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    test("header copies onto the returned response", async () => {
      const req = new Request("http://localhost") as Bun.BunRequest;
      const context = createContext(req);

      context.header("Authorization", "Bearer test");

      const res = applyHeaders(context, context.json(200, { ok: true }));

      expect(res.headers.get("Authorization")).toBe("Bearer test");
      expect(res.headers.get("Content-Type")).toContain("application/json");
    });

    test("header copies onto redirect responses", () => {
      const req = new Request("http://localhost") as Bun.BunRequest;
      const context = createContext(req);

      context.header("Authorization", "Bearer test");

      const res = applyHeaders(
        context,
        context.redirect(302, "https://example.com"),
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("Authorization")).toBe("Bearer test");
      expect(res.headers.get("Location")).toBe("https://example.com");
    });

    test("emptyValidated is frozen defaults", () => {
      expect(emptyValidated.body).toBeUndefined();
      expect(Object.isFrozen(emptyValidated)).toBe(true);
    });
  });

  describe("response helpers", () => {
    test("json uses default status 200", async () => {
      const res = json(200, { ok: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    test("json sets explicit status", async () => {
      const res = json(201, { id: 1 });
      expect(res.status).toBe(201);
    });

    test("text uses default status 200", async () => {
      const res = text(200, "hello");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");
    });

    test("text sets explicit status", async () => {
      const res = text(404, "missing");
      expect(res.status).toBe(404);
    });

    test("html sets content type", async () => {
      const res = html(200, "<p>hi</p>");
      expect(res.headers.get("Content-Type")).toBe("text/html");
      expect(await res.text()).toBe("<p>hi</p>");
    });

    test("redirect returns redirect response", () => {
      const res = redirect(302, "https://example.com");
      expect(res.status).toBe(302);
    });

    test("badRequest returns 400 with message", async () => {
      const res = badRequest("invalid");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: "invalid" });
    });

    test("validatingJson passes valid output", async () => {
      const validate = validatingJson({ 200: z.object({ name: z.string() }) });
      const res = await validate(200, { name: "Alice" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ name: "Alice" });
    });

    test("validatingJson returns 400 for invalid output", async () => {
      const validate = validatingJson({ 200: z.object({ name: z.string() }) });
      const res = await validate(200, { name: 123 });
      expect(res.status).toBe(400);
    });

    test("validatingJson skips validation for unlisted status", async () => {
      const validate = validatingJson({ 200: z.object({ name: z.string() }) });
      const res = await validate(404, { name: 123 });
      expect(res.status).toBe(404);
    });

    test("mapValidationError rethrows schema config errors", () => {
      const error = new SchemaConfigError(
        "Async schema validation is not supported",
      );

      expect(() => mapValidationError(error)).toThrow(SchemaConfigError);
    });

    test("validatingJson rethrows schema config errors", () => {
      const schema = {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: () => Promise.resolve({ value: {} }),
        },
      } as StandardSchemaV1;
      const validate = validatingJson({ 200: schema });

      expect(() => validate(200, {})).toThrow(SchemaConfigError);
    });
  });

  describe("getFullPath", () => {
    test("returns path when no prefix", () => {
      expect(getFullPath({ path: "/hello" })).toBe("/hello");
    });

    test("normalizes trailing slashes on prefix and path", () => {
      expect(getFullPath({ prefix: "/api/", path: "/hello/" })).toBe(
        "/api/hello",
      );
    });

    test("returns prefix when path is root", () => {
      expect(getFullPath({ prefix: "/api/v1", path: "/" })).toBe("/api/v1");
    });

    test("returns path when prefix is root", () => {
      expect(getFullPath({ prefix: "/", path: "/hello" })).toBe("/hello");
    });
  });

  describe("resolveValidation", () => {
    test("defaults to both enabled", () => {
      expect(resolveValidation()).toEqual({ input: true, output: true });
      expect(resolveValidation(true)).toEqual({ input: true, output: true });
    });

    test("disables both when false", () => {
      expect(resolveValidation(false)).toEqual({ input: false, output: false });
    });

    test("respects partial options", () => {
      expect(resolveValidation({ input: false })).toEqual({
        input: false,
        output: true,
      });
      expect(resolveValidation({ output: false })).toEqual({
        input: true,
        output: false,
      });
    });
  });

  describe("bodyHasMultipleReaders", () => {
    test("returns false for single body reader", () => {
      expect(
        bodyHasMultipleReaders({
          middlewares: [],
          request: { body: z.object({ name: z.string() }) },
        }),
      ).toBe(false);
    });

    test("returns true when middleware and route both read body", () => {
      const mw = new Middleware({
        request: { body: z.object({ name: z.string() }) },
        handler: () => ({}),
      });

      expect(
        bodyHasMultipleReaders({
          middlewares: [mw],
          request: { body: z.object({ name: z.string(), age: z.number() }) },
        }),
      ).toBe(true);
    });
  });
});
