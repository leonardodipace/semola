import { describe, expect, test } from "bun:test";
import {
  convertPathToBunFormat,
  parseCookies,
  parseQueryString,
} from "./router.js";

describe("convertPathToBunFormat", () => {
  test("should convert single path parameter", () => {
    expect(convertPathToBunFormat("/users/{id}")).toBe("/users/:id");
  });

  test("should convert multiple path parameters", () => {
    expect(convertPathToBunFormat("/users/{userId}/posts/{postId}")).toBe(
      "/users/:userId/posts/:postId",
    );
  });

  test("should handle paths without parameters", () => {
    expect(convertPathToBunFormat("/users")).toBe("/users");
  });

  test("should handle root path", () => {
    expect(convertPathToBunFormat("/")).toBe("/");
  });

  test("should handle nested parameters", () => {
    expect(convertPathToBunFormat("/a/{b}/c/{d}/e/{f}")).toBe(
      "/a/:b/c/:d/e/:f",
    );
  });
});

describe("parseQueryString", () => {
  test("should parse single query parameter", () => {
    const url = new URL("http://example.com?name=John");
    expect(parseQueryString(url)).toEqual({ name: "John" });
  });

  test("should parse multiple query parameters", () => {
    const url = new URL("http://example.com?name=John&age=30");
    expect(parseQueryString(url)).toEqual({ name: "John", age: "30" });
  });

  test("should handle duplicate query parameters as array", () => {
    const url = new URL("http://example.com?tag=js&tag=ts&tag=node");
    expect(parseQueryString(url)).toEqual({ tag: ["js", "ts", "node"] });
  });

  test("should handle empty query string", () => {
    const url = new URL("http://example.com");
    expect(parseQueryString(url)).toEqual({});
  });

  test("should handle query parameters with empty values", () => {
    const url = new URL("http://example.com?name=&age=30");
    expect(parseQueryString(url)).toEqual({ name: "", age: "30" });
  });

  test("should handle special characters in query values", () => {
    const url = new URL("http://example.com?message=Hello%20World");
    expect(parseQueryString(url)).toEqual({ message: "Hello World" });
  });

  test("should handle multiple values for same key correctly", () => {
    const url = new URL("http://example.com?id=1&id=2");
    expect(parseQueryString(url)).toEqual({ id: ["1", "2"] });
  });
});

describe("parseCookies", () => {
  test("should parse single cookie", () => {
    expect(parseCookies("sessionId=abc123")).toEqual({
      sessionId: "abc123",
    });
  });

  test("should parse multiple cookies", () => {
    expect(parseCookies("sessionId=abc123; userId=user456")).toEqual({
      sessionId: "abc123",
      userId: "user456",
    });
  });

  test("should handle null cookie header", () => {
    expect(parseCookies(null)).toEqual({});
  });

  test("should handle empty cookie header", () => {
    expect(parseCookies("")).toEqual({});
  });

  test("should trim whitespace from cookie names and values", () => {
    expect(parseCookies("  sessionId = abc123 ; userId = user456  ")).toEqual({
      sessionId: "abc123",
      userId: "user456",
    });
  });

  test("should ignore malformed cookies without value", () => {
    expect(
      parseCookies("sessionId=abc123; invalidCookie; userId=user456"),
    ).toEqual({
      sessionId: "abc123",
      userId: "user456",
    });
  });

  test("should ignore cookies with empty key", () => {
    expect(parseCookies("=value; sessionId=abc123")).toEqual({
      sessionId: "abc123",
    });
  });

  test("should ignore cookies with empty value", () => {
    expect(parseCookies("sessionId=; userId=user456")).toEqual({
      userId: "user456",
    });
  });

  test("should handle cookies with equals sign in value", () => {
    expect(parseCookies("data=key=value")).toEqual({
      data: "key=value",
    });
  });
});
