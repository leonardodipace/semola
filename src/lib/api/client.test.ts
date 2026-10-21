import { describe, expect, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { Api } from "./api.js";
import { ApiClient } from "./client.js";
import { ApiClientError } from "./errors.js";
import { Group } from "./group.js";
import type { ApiClientFetch } from "./types.js";

const apiFetch =
  (api: Api): ApiClientFetch =>
  (input, init) => {
    if (input instanceof Request) return api.fetch(input);

    return api.fetch(new Request(String(input), init));
  };

type CapturedFetch = {
  input: string | URL | Request;
  init?: RequestInit;
};

const captureFetch = (response?: Response) => {
  const calls: CapturedFetch[] = [];

  const fetch: ApiClientFetch = async (input, init) => {
    calls.push({ input, init });

    if (response) return response;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { calls, fetch };
};

const onlyCall = (calls: CapturedFetch[]) => {
  expect(calls.length).toBe(1);

  const [call] = calls;

  if (!call) throw new Error("expected fetch call");

  return call;
};

const requestUrl = (call: CapturedFetch) => String(call.input);

const requestMethod = (call: CapturedFetch) => call.init?.method ?? "GET";

const requestHeaders = (call: CapturedFetch) => new Headers(call.init?.headers);

const requestBody = (call: CapturedFetch) => {
  if (call.init?.body == null) return null;

  return String(call.init.body);
};

describe("ApiClient", () => {
  test("calls nested router procedures with typed input", async () => {
    const api = new Api();

    const getUser = api.defineRoute({
      path: "/users/:id",
      method: "GET",
      request: {
        params: z.object({ id: z.string() }),
      },
      response: {
        200: z.object({ id: z.string(), email: z.string() }),
      },
      handler: (c) =>
        c.json(200, { id: c.req.params.id, email: "hi@semo.la" }),
    });

    const createUser = api.defineRoute({
      path: "/users",
      method: "POST",
      request: {
        body: z.object({ email: z.string() }),
      },
      response: {
        201: z.object({ id: z.string(), email: z.string() }),
      },
      handler: (c) => c.json(201, { id: "u_1", email: c.req.body.email }),
    });

    const appRouter = {
      users: {
        get: getUser,
        create: createUser,
      },
    };

    const client = new ApiClient({
      router: appRouter,
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    const user = await client.users.get({ params: { id: "42" } });

    expect(user).toEqual({ id: "42", email: "hi@semo.la" });
    expectTypeOf(user).toEqualTypeOf<{ id: string; email: string }>();

    const created = await client.users.create({
      body: { email: "new@semo.la" },
    });

    expect(created).toEqual({ id: "u_1", email: "new@semo.la" });
    expectTypeOf(created).toEqualTypeOf<{ id: string; email: string }>();
  });

  test("resolves group prefixes after mount", async () => {
    const api = new Api({ prefix: "/api" });
    const users = new Group({ prefix: "/users" });

    const list = users.defineRoute({
      path: "/",
      method: "GET",
      response: {
        200: z.object({ items: z.array(z.string()) }),
      },
      handler: () => ({ items: ["a"] }),
    });

    api.mount(users);

    const client = new ApiClient({
      router: { users: { list } },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    const result = await client.users.list();

    expect(result).toEqual({ items: ["a"] });
  });

  test("sends query params", async () => {
    const api = new Api();

    const search = api.defineRoute({
      path: "/search",
      method: "GET",
      request: {
        query: z.object({ q: z.string() }),
      },
      response: {
        200: z.object({ q: z.string() }),
      },
      handler: (c) => c.json(200, { q: c.req.query.q }),
    });

    const client = new ApiClient({
      router: { search },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    const result = await client.search({ query: { q: "semola" } });

    expect(result).toEqual({ q: "semola" });
  });

  test("throws ApiClientError on non-2xx", async () => {
    const api = new Api();

    const fail = api.defineRoute({
      path: "/fail",
      method: "GET",
      response: {
        400: z.object({ message: z.string() }),
      },
      handler: (c) => c.json(400, { message: "nope" }),
    });

    const client = new ApiClient({
      router: { fail },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    try {
      await client.fail();
      throw new Error("expected ApiClientError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);

      if (!(error instanceof ApiClientError)) return;

      expect(error.status).toBe(400);
      expect(error.body).toEqual({ message: "nope" });
    }
  });

  test("throws when path param missing", async () => {
    const api = new Api();

    const getUser = api.defineRoute({
      path: "/users/:id",
      method: "GET",
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { getUser },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    try {
      await client.getUser({});
      throw new Error("expected ApiClientError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);

      if (!(error instanceof ApiClientError)) return;

      expect(error.message).toBe("Missing path param: id");
    }
  });
});

describe("ApiClient edges", () => {
  test("strips trailing slashes from baseUrl", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const ping = api.defineRoute({
      path: "/ping",
      method: "GET",
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { ping },
      baseUrl: "http://localhost///",
      fetch,
    });

    await client.ping();

    expect(requestUrl(onlyCall(calls))).toBe("http://localhost/ping");
  });

  test("joins root path with baseUrl", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const root = api.defineRoute({
      path: "/",
      method: "GET",
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { root },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.root();

    expect(requestUrl(onlyCall(calls))).toBe("http://localhost/");
  });

  test("rejects empty baseUrl", async () => {
    const { fetch } = captureFetch();
    const api = new Api();

    const ping = api.defineRoute({
      path: "/ping",
      method: "GET",
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { ping },
      baseUrl: "",
      fetch,
    });

    try {
      await client.ping();
      throw new Error("expected URL error");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
  });

  test("encodes path params with reserved characters", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const get = api.defineRoute({
      path: "/users/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { get },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.get({ params: { id: "a/b c?d=e&f" } });

    expect(requestUrl(onlyCall(calls))).toBe(
      "http://localhost/users/a%2Fb%20c%3Fd%3De%26f",
    );
  });

  test("substitutes multiple path params", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const get = api.defineRoute({
      path: "/orgs/:org/users/:id",
      method: "GET",
      request: {
        params: z.object({ org: z.string(), id: z.string() }),
      },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { get },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.get({ params: { org: "acme", id: "9" } });

    expect(requestUrl(onlyCall(calls))).toBe(
      "http://localhost/orgs/acme/users/9",
    );
  });

  test("skips null and undefined query values", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const search = api.defineRoute({
      path: "/search",
      method: "GET",
      request: {
        query: z.object({
          q: z.string(),
          page: z.string().nullable().optional(),
        }),
      },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { search },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.search({ query: { q: "hi", page: null } });

    expect(requestUrl(onlyCall(calls))).toBe("http://localhost/search?q=hi");
  });

  test("encodes reserved characters in query values", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const search = api.defineRoute({
      path: "/search",
      method: "GET",
      request: { query: z.object({ q: z.string() }) },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { search },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.search({ query: { q: "a b&c=d" } });

    const url = new URL(requestUrl(onlyCall(calls)));

    expect(url.searchParams.get("q")).toBe("a b&c=d");
  });

  test("sends JSON body and content-type for POST", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const create = api.defineRoute({
      path: "/users",
      method: "POST",
      request: { body: z.object({ email: z.string() }) },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { create },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.create({ body: { email: "a@b.co" } });

    const call = onlyCall(calls);

    expect(requestMethod(call)).toBe("POST");
    expect(requestBody(call)).toBe(JSON.stringify({ email: "a@b.co" }));
    expect(requestHeaders(call).get("content-type")).toBe("application/json");
  });

  test("omits body when input has none", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const list = api.defineRoute({
      path: "/users",
      method: "GET",
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { list },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.list();

    const call = onlyCall(calls);

    expect(requestMethod(call)).toBe("GET");
    expect(requestBody(call)).toBeNull();
  });

  test("merges default headers and lets call headers override", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const ping = api.defineRoute({
      path: "/ping",
      method: "GET",
      request: {
        headers: z.object({ authorization: z.string().optional() }),
      },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { ping },
      baseUrl: "http://localhost",
      headers: { "x-client": "semola", authorization: "Bearer t" },
      fetch,
    });

    await client.ping({ headers: { authorization: "Bearer override" } });

    const headers = requestHeaders(onlyCall(calls));

    expect(headers.get("x-client")).toBe("semola");
    expect(headers.get("authorization")).toBe("Bearer override");
  });

  test("sends cookies as Cookie header", async () => {
    const api = new Api();

    const echo = api.defineRoute({
      path: "/echo-cookies",
      method: "GET",
      request: {
        cookies: z.object({ session: z.string() }),
      },
      response: { 200: z.object({ session: z.string() }) },
      handler: (c) => c.json(200, { session: c.req.cookies.session }),
    });

    const client = new ApiClient({
      router: { echo },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    const result = await client.echo({
      cookies: { session: "abc" },
    });

    expect(result).toEqual({ session: "abc" });
  });

  test("accepts 204 empty success body", async () => {
    const api = new Api();

    const remove = api.defineRoute({
      path: "/items/:id",
      method: "DELETE",
      request: { params: z.object({ id: z.string() }) },
      handler: () => new Response(null, { status: 204 }),
    });

    const client = new ApiClient({
      router: { remove },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    const result = await client.remove({ params: { id: "1" } });

    expect(result).toBeUndefined();
  });

  test("throws ApiClientError with raw text for non-JSON error body", async () => {
    const { fetch } = captureFetch(
      new Response("plain fail", {
        status: 400,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const api = new Api();

    const fail = api.defineRoute({
      path: "/fail",
      method: "GET",
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { fail },
      baseUrl: "http://localhost",
      fetch,
    });

    try {
      await client.fail();
      throw new Error("expected ApiClientError");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);

      if (!(error instanceof ApiClientError)) return;

      expect(error.status).toBe(400);
      expect(error.body).toBe("plain fail");
    }
  });

  test("combines path params query and body on one call", async () => {
    const api = new Api();

    const update = api.defineRoute({
      path: "/items/:id",
      method: "PUT",
      request: {
        params: z.object({ id: z.string() }),
        query: z.object({ dryRun: z.string() }),
        body: z.object({ name: z.string() }),
      },
      response: {
        200: z.object({
          id: z.string(),
          dryRun: z.string(),
          name: z.string(),
        }),
      },
      handler: (c) =>
        c.json(200, {
          id: c.req.params.id,
          dryRun: c.req.query.dryRun,
          name: c.req.body.name,
        }),
    });

    const client = new ApiClient({
      router: { update },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    const result = await client.update({
      params: { id: "7" },
      query: { dryRun: "true" },
      body: { name: "x" },
    });

    expect(result).toEqual({ id: "7", dryRun: "true", name: "x" });
  });

  test("path without leading slash still joins baseUrl", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const ping = api.defineRoute({
      path: "ping",
      method: "GET",
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { ping },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.ping();

    expect(requestUrl(onlyCall(calls))).toBe("http://localhost/ping");
  });

  test("empty string path param still substitutes", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const get = api.defineRoute({
      path: "/users/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = new ApiClient({
      router: { get },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.get({ params: { id: "" } });

    expect(requestUrl(onlyCall(calls))).toBe("http://localhost/users/");
  });
});
