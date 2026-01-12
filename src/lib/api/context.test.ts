import { describe, expect, test } from "bun:test";
import { RequestContext } from "./context.js";

describe("RequestContext", () => {
  const mockRequest = new Request("http://localhost:3000/test");
  const mockValidatedData = {
    body: { name: "John" },
    params: { id: "123" },
    query: { search: "test" },
    headers: { authorization: "Bearer token" },
    cookies: { sessionId: "abc123" },
  };

  const mockValidateResponse = async () => [null, { success: true }] as const;
  const mockHandleError = async () => new Response();

  test("should initialize with validated data", () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    expect(context.request.body).toEqual({ name: "John" });
    expect(context.request.params).toEqual({ id: "123" });
    expect(context.request.query).toEqual({ search: "test" });
    expect(context.request.headers).toEqual({ authorization: "Bearer token" });
    expect(context.request.cookies).toEqual({ sessionId: "abc123" });
    expect(context.raw).toBe(mockRequest);
  });

  test("should return json response with valid data", async () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response = await context.json(200, { success: true });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ success: true });
  });

  test("should return error when response validation fails", async () => {
    const failingValidate = async () =>
      [{ type: "ValidationError", message: "Invalid response" }, null] as const;

    const errorResponse = new Response(
      JSON.stringify({ error: "Validation failed" }),
      {
        status: 500,
      },
    );

    const handleError = async () => errorResponse;

    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      failingValidate,
      handleError,
    );

    const response = await context.json(200, { invalid: "data" });

    expect(response).toBe(errorResponse);
  });

  test("should return text response", () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response = context.text(200, "Hello, world");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  test("should return text response with correct body", async () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response = context.text(200, "Plain text message");
    const text = await response.text();

    expect(text).toBe("Plain text message");
  });

  test("should return html response", () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response = context.html(200, "<h1>Hello</h1>");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
  });

  test("should return html response with correct body", async () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response = context.html(200, "<div>Content</div>");
    const html = await response.text();

    expect(html).toBe("<div>Content</div>");
  });

  test("should return redirect response", () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response = context.redirect(302, "/new-location");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/new-location");
  });

  test("should handle different redirect status codes", () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response301 = context.redirect(301, "/permanent");
    expect(response301.status).toBe(301);

    const response307 = context.redirect(307, "/temporary");
    expect(response307.status).toBe(307);

    const response308 = context.redirect(308, "/permanent-redirect");
    expect(response308.status).toBe(308);
  });

  test("should handle different status codes for json", async () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response201 = await context.json(201, { created: true });
    expect(response201.status).toBe(201);

    const response404 = await context.json(404, { found: false });
    expect(response404.status).toBe(404);
  });

  test("should handle different status codes for text", () => {
    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    const response500 = context.text(500, "Internal Server Error");
    expect(response500.status).toBe(500);

    const response201 = context.text(201, "Created");
    expect(response201.status).toBe(201);
  });

  test("should preserve raw request", () => {
    const customRequest = new Request("http://example.com/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    const context = new RequestContext(
      customRequest,
      mockValidatedData,
      mockValidateResponse,
      mockHandleError,
    );

    expect(context.raw).toBe(customRequest);
    expect(context.raw.url).toBe("http://example.com/api/data");
    expect(context.raw.method).toBe("POST");
  });

  test("should handle empty validated data", () => {
    const emptyData = {
      body: undefined,
      params: undefined,
      query: undefined,
      headers: undefined,
      cookies: undefined,
    };

    const context = new RequestContext(
      mockRequest,
      emptyData,
      mockValidateResponse,
      mockHandleError,
    );

    expect(context.request.body).toBeUndefined();
    expect(context.request.params).toBeUndefined();
    expect(context.request.query).toBeUndefined();
    expect(context.request.headers).toBeUndefined();
    expect(context.request.cookies).toBeUndefined();
  });

  test("should handle complex nested data in json response", async () => {
    const complexData = {
      user: {
        id: 1,
        name: "John",
        addresses: [
          { street: "123 Main St", city: "NYC" },
          { street: "456 Oak Ave", city: "LA" },
        ],
      },
      metadata: { createdAt: "2025-01-01T00:00:00.000Z" },
    };

    const passthrough = async (_status: number, data: unknown) =>
      [null, data] as const;

    const context = new RequestContext(
      mockRequest,
      mockValidatedData,
      passthrough,
      mockHandleError,
    );

    const response = await context.json(200, complexData);
    const data = await response.json();

    expect(data).toEqual(complexData);
  });
});
