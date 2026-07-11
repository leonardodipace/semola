import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { Api } from "./api.js";
import { Group } from "./group.js";
import { Middleware } from "./middleware.js";

describe("Group", () => {
  test("mounts grouped routes", async () => {
    const api = new Api({ prefix: "/api/v1" });
    const users = new Group({ prefix: "/users" });

    users.defineRoute({
      path: "/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      handler: (c) => c.json(200, { id: c.req.params.id }),
    });

    api.mount(users);

    const res = await api.fetch(
      new Request("http://localhost/api/v1/users/123"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "123" });
  });

  test("applies api, group and route middlewares in order", async () => {
    const global = new Middleware({
      handler: () => ({ chain: ["api"] }),
    });
    const grouped = new Middleware({
      handler: (c) => ({ chain: [...(c.get("chain") as string[]), "group"] }),
    });
    const route = new Middleware({
      handler: (c) => ({ chain: [...(c.get("chain") as string[]), "route"] }),
    });

    const api = new Api({ middlewares: [global] as const });
    const users = new Group({
      prefix: "/users",
      middlewares: [grouped] as const,
    });

    users.defineRoute({
      path: "/chain",
      method: "GET",
      middlewares: [route] as const,
      handler: (c) => c.json(200, { chain: c.get("chain") }),
    });

    api.mount(users);

    const res = await api.fetch(new Request("http://localhost/users/chain"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ chain: ["api", "group", "route"] });
  });

  test("supports nested groups", async () => {
    const api = new Api({ prefix: "/api" });
    const users = new Group({ prefix: "/users" });
    const posts = new Group({ prefix: "/posts" });

    posts.defineRoute({
      path: "/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      handler: (c) => c.json(200, { id: c.req.params.id }),
    });

    users.mount(posts);
    api.mount(users);

    const res = await api.fetch(
      new Request("http://localhost/api/users/posts/9"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "9" });
  });

  test("recompiles when routes are added after mount", async () => {
    const api = new Api({ prefix: "/api" });
    const users = new Group({ prefix: "/users" });

    api.mount(users);

    await api.fetch(new Request("http://localhost/api/users/1"));

    users.defineRoute({
      path: "/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      handler: (c) => c.json(200, { id: c.req.params.id }),
    });

    const res = await api.fetch(new Request("http://localhost/api/users/1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "1" });
  });

  test("throws on duplicate method and path", () => {
    const api = new Api();

    api.defineRoute({
      path: "/dup",
      method: "GET",
      handler: () => "a",
    });
    api.defineRoute({
      path: "/dup",
      method: "GET",
      handler: () => "b",
    });

    expect(() => api.getRouteHandlers()).toThrow("Duplicate route: GET /dup");
  });

  test("does not expose runtime methods", () => {
    const group = new Group();
    const shape = group as unknown as Record<string, unknown>;

    expect(shape.fetch).toBeUndefined();
    expect(shape.serve).toBeUndefined();
    expect(shape.getRouteHandlers).toBeUndefined();
    expect(shape.getOpenApiSpec).toBeUndefined();
  });
});
