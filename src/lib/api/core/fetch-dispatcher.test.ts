import { describe, expect, test } from "bun:test";
import { buildFetchDispatcher } from "./fetch-dispatcher.js";
import type { MethodRoutes } from "./types.js";

const GET = "GET" as const satisfies Bun.Serve.HTTPMethod;
const POST = "POST" as const satisfies Bun.Serve.HTTPMethod;

describe("fetch-dispatcher", () => {
  test("dispatches static routes", async () => {
    const routes: MethodRoutes = {
      "/hello": {
        [GET]: () => new Response("ok"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/hello"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("dispatches dynamic routes with params", async () => {
    const routes: MethodRoutes = {
      "/users/:id": {
        [GET]: (req) => Response.json({ id: req.params?.id }),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/users/abc"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc" });
  });

  test("dispatches dynamic routes with multiple raw params", async () => {
    const routes: MethodRoutes = {
      "/users/:id/books/:bookId": {
        [GET]: (req) =>
          Response.json({
            id: req.params?.id,
            bookId: req.params?.bookId,
          }),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(
      new Request("http://localhost/users/a%20b/books/42"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "a%20b", bookId: "42" });
  });

  test("returns 404 when dynamic path or method does not match", async () => {
    const routes: MethodRoutes = {
      "/users/:id": {
        [POST]: () => new Response("created"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const methodRes = await dispatch(new Request("http://localhost/users/abc"));
    const pathRes = await dispatch(
      new Request("http://localhost/users/abc/books"),
    );

    expect(methodRes.status).toBe(404);
    expect(pathRes.status).toBe(404);
  });

  test("keeps URLPattern fallback for wildcard routes", async () => {
    const routes: MethodRoutes = {
      "/files/*": {
        [GET]: () => new Response("wild"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/files/a/b"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("wild");
  });

  test("normalizes trailing slashes", async () => {
    const routes: MethodRoutes = {
      "/hello": {
        [GET]: () => new Response("ok"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/hello/"));

    expect(await res.text()).toBe("ok");
  });
});
