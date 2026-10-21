import { describe, expect, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { Api } from "./api.js";
import { ApiClient } from "./client.js";
import { ApiClientError } from "./errors.js";
import { Group } from "./group.js";
import type {
  ApiClientFetch,
  ClientCallInput,
  InferClientData,
} from "./types.js";

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

    return Response.json({ ok: true });
  };

  return { calls, fetch };
};

const onlyCall = (calls: CapturedFetch[]) => {
  expect(calls.length).toBe(1);

  const [call] = calls;

  if (!call) throw new Error("expected fetch call");

  return call;
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
      handler: (c) => c.json(200, { id: c.req.params.id, email: "hi@semo.la" }),
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

    const client = ApiClient({
      router: {
        users: {
          get: getUser,
          create: createUser,
        },
      },
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

    const client = ApiClient({
      router: { users: { list } },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    expect(await client.users.list()).toEqual({ items: ["a"] });
  });

  test("sends query params and skips nullish", async () => {
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

    const client = ApiClient({
      router: { search },
      baseUrl: "http://localhost///",
      fetch,
    });

    await client.search({ query: { q: "hi", page: null } });

    expect(String(onlyCall(calls).input)).toBe("http://localhost/search?q=hi");
  });

  test("repeats array query params", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const search = api.defineRoute({
      path: "/search",
      method: "GET",
      request: {
        query: z.object({
          ids: z.array(z.string()),
        }),
      },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = ApiClient({
      router: { search },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.search({ query: { ids: ["a", "b"] } });

    expect(String(onlyCall(calls).input)).toBe(
      "http://localhost/search?ids=a&ids=b",
    );
  });

  test("InferClientData uses 2xx bodies only", () => {
    const created = z.object({ id: z.string() });
    const failed = z.object({ error: z.string() });

    type Data = InferClientData<{ 201: typeof created; 400: typeof failed }>;

    expectTypeOf<Data>().toEqualTypeOf<{ id: string }>();
  });

  test("ClientCallInput omits cookies", () => {
    const cookies = z.object({ session: z.string() });
    const query = z.object({ q: z.string() });

    type Input = ClientCallInput<{
      cookies: typeof cookies;
      query: typeof query;
    }>;

    expectTypeOf<Input>().toEqualTypeOf<{ query: { q: string } }>();
  });

  test("encodes path params and sends JSON body", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const create = api.defineRoute({
      path: "/users/:id",
      method: "POST",
      request: {
        params: z.object({ id: z.string() }),
        body: z.object({ email: z.string() }),
      },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = ApiClient({
      router: { create },
      baseUrl: "http://localhost",
      fetch,
    });

    await client.create({
      params: { id: "a/b" },
      body: { email: "a@b.co" },
    });

    const call = onlyCall(calls);

    expect(String(call.input)).toBe("http://localhost/users/a%2Fb");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(JSON.stringify({ email: "a@b.co" }));
    expect(new Headers(call.init?.headers).get("content-type")).toBe(
      "application/json",
    );
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

    const client = ApiClient({
      router: { ping },
      baseUrl: "http://localhost",
      headers: { "x-client": "semola", authorization: "Bearer t" },
      fetch,
    });

    await client.ping({ headers: { authorization: "Bearer override" } });

    const headers = new Headers(onlyCall(calls).init?.headers);

    expect(headers.get("x-client")).toBe("semola");
    expect(headers.get("authorization")).toBe("Bearer override");
  });

  test("skips nullish call headers", async () => {
    const { calls, fetch } = captureFetch();
    const api = new Api();

    const ping = api.defineRoute({
      path: "/ping",
      method: "GET",
      request: {
        headers: z.object({
          authorization: z.string().nullable().optional(),
        }),
      },
      response: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    });

    const client = ApiClient({
      router: { ping },
      baseUrl: "http://localhost",
      headers: { authorization: "Bearer t" },
      fetch,
    });

    await client.ping({ headers: { authorization: undefined } });
    await client.ping({ headers: { authorization: null } });

    expect(calls.length).toBe(2);

    for (const call of calls) {
      expect(new Headers(call.init?.headers).get("authorization")).toBe(
        "Bearer t",
      );
    }
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

    const client = ApiClient({
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

    const client = ApiClient({
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

  test("accepts empty 204 body", async () => {
    const api = new Api();

    const remove = api.defineRoute({
      path: "/items/:id",
      method: "DELETE",
      request: { params: z.object({ id: z.string() }) },
      handler: () => new Response(null, { status: 204 }),
    });

    const client = ApiClient({
      router: { remove },
      baseUrl: "http://localhost",
      fetch: apiFetch(api),
    });

    expect(await client.remove({ params: { id: "1" } })).toBeUndefined();
  });
});
