import { describe, expect, test } from "bun:test";
import { buildFetchDispatcher } from "./fetch-dispatcher.js";
import type { MethodRoutes } from "./types.js";

const GET = "GET" as const satisfies Bun.Serve.HTTPMethod;

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
