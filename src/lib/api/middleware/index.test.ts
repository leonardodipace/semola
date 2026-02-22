import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Middleware } from "./index.js";

describe("Middleware", () => {
  test("should initialize with a basic handler", () => {
    const handler = () => ({ user: "test" });
    const mw = new Middleware({ handler });

    expect(mw.options.handler).toBe(handler);
    expect(mw.options.request).toBeUndefined();
  });

  test("should store request and response schemas", () => {
    const requestSchema = { body: z.object({ name: z.string() }) };
    const responseSchema = { 200: z.object({ id: z.number() }) };

    const mw = new Middleware({
      request: requestSchema,
      response: responseSchema,
      handler: () => ({ ok: true }),
    });

    expect(mw.options.request).toBe(requestSchema);
    expect(mw.options.response).toBe(responseSchema);
  });

  test("should support async handlers", async () => {
    const handler = async () => {
      return { data: "async-result" };
    };
    const mw = new Middleware({ handler });

    const result = await mw.options.handler({} as any);
    expect(result).toEqual({ data: "async-result" });
  });

  test("should support handlers returning a Response (for guards)", () => {
    const handler = () => new Response("Unauthorized", { status: 401 });
    const mw = new Middleware({ handler });

    const result = mw.options.handler({} as any);
    expect(result).toBeInstanceOf(Response);
  });

  test("should handle multiple request validation zones", () => {
    const schemas = {
      body: z.object({ id: z.string() }),
      query: z.object({ search: z.string() }),
      headers: z.object({ "x-api-key": z.string() }),
      cookies: z.object({ session: z.string() }),
    };

    const mw = new Middleware({
      request: schemas,
      handler: () => ({}),
    });

    expect(mw.options.request?.body).toBe(schemas.body);
    expect(mw.options.request?.query).toBe(schemas.query);
    expect(mw.options.request?.headers).toBe(schemas.headers);
    expect(mw.options.request?.cookies).toBe(schemas.cookies);
  });

  test("should support handlers returning nothing (void/undefined)", () => {
    const handler = () => undefined;
    const mw = new Middleware({ handler });

    const result = mw.options.handler({} as any);
    expect(result).toBeUndefined();
  });

  test("should support async handlers returning nothing", async () => {
    const handler = async () => undefined;
    const mw = new Middleware({ handler });

    const result = await mw.options.handler({} as any);
    expect(result).toBeUndefined();
  });

  test("should handle multiple response status codes", () => {
    const responseSchemas = {
      200: z.string(),
      404: z.object({ error: z.string() }),
      500: z.object({ message: z.string() }),
    };

    const mw = new Middleware({
      response: responseSchemas,
      handler: () => ({}),
    });

    expect(mw.options.response?.[200]).toBe(responseSchemas[200]);
    expect(mw.options.response?.[404]).toBe(responseSchemas[404]);
    expect(mw.options.response?.[500]).toBe(responseSchemas[500]);
  });
});
