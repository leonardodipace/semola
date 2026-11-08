import { describe, expect, test } from "bun:test";
import { buildFetchDispatcher } from "./dispatch.js";
import type { HTTPMethod, MethodRoutes } from "./types.js";

const GET = "GET" as const satisfies HTTPMethod;
const POST = "POST" as const satisfies HTTPMethod;
const HEAD = "HEAD" as const satisfies HTTPMethod;

describe("dispatch", () => {
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

  test("dispatches dynamic routes with multiple decoded params", async () => {
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
    expect(await res.json()).toEqual({ id: "a b", bookId: "42" });
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

  test("decodes params in wildcard routes", async () => {
    const routes: MethodRoutes = {
      "/files/:owner/*": {
        [GET]: (req) => Response.json({ owner: req.params?.owner }),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/files/a%20b/x"));

    expect(await res.json()).toEqual({ owner: "a b" });
  });

  test("answers HEAD with the GET handler", async () => {
    const routes: MethodRoutes = {
      "/hello": {
        [GET]: () => new Response("ok"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(
      new Request("http://localhost/hello", { method: "HEAD" }),
    );

    expect(res.status).toBe(200);
  });

  test("matches the path before falling back from HEAD to GET", async () => {
    const routes: MethodRoutes = {
      "/files/new": {
        [GET]: () => new Response(null, { headers: { "x-route": "static" } }),
      },
      "/files/:id": {
        [HEAD]: () => new Response(null, { headers: { "x-route": "dynamic" } }),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(
      new Request("http://localhost/files/new", { method: "HEAD" }),
    );

    expect(res.headers.get("x-route")).toBe("static");
  });

  test("matches regex characters in wildcard paths literally", async () => {
    const routes: MethodRoutes = {
      "/v1.0/*": {
        [GET]: (req) => Response.json(req.params),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const literal = await dispatch(new Request("http://localhost/v1.0/a/b"));
    const other = await dispatch(new Request("http://localhost/v1x0/a"));

    expect(await literal.json()).toEqual({ "0": "a/b" });
    expect(other.status).toBe(404);
  });

  test("matches routes registered with non-ASCII characters", async () => {
    const routes: MethodRoutes = {
      "/café/:id": {
        [GET]: (req) => Response.json(req.params),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/café/1"));

    expect(await res.json()).toEqual({ id: "1" });
  });

  test("matches route paths with characters URLs percent-encode", async () => {
    const routes: MethodRoutes = {
      "/files/{latest}": {
        [GET]: () => new Response("braces"),
      },
      "/a b": {
        [GET]: () => new Response("space"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const braces = await dispatch(
      new Request("http://localhost/files/{latest}"),
    );
    const space = await dispatch(new Request("http://localhost/a b"));

    expect(await braces.text()).toBe("braces");
    expect(await space.text()).toBe("space");
  });

  test("names wildcard route params like dynamic ones", async () => {
    const routes: MethodRoutes = {
      "/orgs/:org-id/*": {
        [GET]: (req) => Response.json(req.params),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/orgs/acme/x"));

    expect(await res.json()).toEqual({ "org-id": "acme", "0": "x" });
  });

  test("ignores object prototype keys sent as the method", async () => {
    const routes: MethodRoutes = {
      "/hello": {
        [GET]: () => new Response("ok"),
      },
    };

    // Bun's Request rewrites unknown methods to GET; Node's keeps them.
    const req = { url: "http://localhost/hello", method: "constructor" };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(req as unknown as Request);

    expect(res.status).toBe(404);
  });

  test("keeps a double-slash route apart from the root route", async () => {
    const routes: MethodRoutes = {
      "/": {
        [GET]: () => new Response("root"),
      },
      "//admin": {
        [GET]: () => new Response("admin"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/"));

    expect(await res.text()).toBe("root");
  });

  test("keeps a colon inside a wildcard route segment literal", async () => {
    const routes: MethodRoutes = {
      "/v1/things:batch/*": {
        [GET]: (req) => Response.json(req.params),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const literal = await dispatch(
      new Request("http://localhost/v1/things:batch/q"),
    );
    const other = await dispatch(
      new Request("http://localhost/v1/thingsXYZ/q"),
    );

    expect(await literal.json()).toEqual({ "0": "q" });
    expect(other.status).toBe(404);
  });

  test("keeps a catch-all route apart from the root route", async () => {
    const routes: MethodRoutes = {
      "/": {
        [GET]: () => new Response("root"),
      },
      "/*": {
        [GET]: () => new Response("catch-all"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const root = await dispatch(new Request("http://localhost/"));
    const other = await dispatch(new Request("http://localhost/anything"));

    expect(await root.text()).toBe("root");
    expect(await other.text()).toBe("catch-all");
  });

  test("matches a trailing wildcard without anything after the slash", async () => {
    const routes: MethodRoutes = {
      "/files/*": {
        [GET]: () => new Response("files"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const withSlash = await dispatch(new Request("http://localhost/files/"));
    const withoutSlash = await dispatch(new Request("http://localhost/files"));

    expect(await withSlash.text()).toBe("files");
    expect(withoutSlash.status).toBe(404);
  });

  test("prefers the most specific route regardless of order", async () => {
    const routes: MethodRoutes = {
      "/u/:id/posts": {
        [GET]: () => new Response("id-posts"),
      },
      "/u/me/:tab": {
        [GET]: () => new Response("me-tab"),
      },
      "/f/*": {
        [GET]: () => new Response("f-wild"),
      },
      "/f/x/*": {
        [GET]: () => new Response("fx-wild"),
      },
      "/:org/:repo": {
        [GET]: () => new Response("org-repo"),
      },
      "/static/*": {
        [GET]: () => new Response("static-wild"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const dynamic = await dispatch(new Request("http://localhost/u/me/posts"));
    const wildcard = await dispatch(new Request("http://localhost/f/x/y"));
    const literalWildcard = await dispatch(
      new Request("http://localhost/static/app"),
    );

    expect(await dynamic.text()).toBe("me-tab");
    expect(await wildcard.text()).toBe("fx-wild");
    expect(await literalWildcard.text()).toBe("static-wild");
  });

  test("orders routes consistently when one path extends another", async () => {
    const routes: MethodRoutes = {
      "/:p/:q": {
        [GET]: () => new Response("param-param"),
      },
      "/:p": {
        [GET]: () => new Response("param"),
      },
      "/:p/x": {
        [GET]: () => new Response("param-literal"),
      },
      "/files/*": {
        [GET]: () => new Response("wildcard"),
      },
      "/files": {
        [POST]: () => new Response("static"),
      },
      "/files/:id": {
        [GET]: () => new Response("id"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const literal = await dispatch(new Request("http://localhost/1/x"));
    const param = await dispatch(new Request("http://localhost/files/1"));

    expect(await literal.text()).toBe("param-literal");
    expect(await param.text()).toBe("id");
  });

  test("ignores a fragment in the request URL", async () => {
    const routes: MethodRoutes = {
      "/hello": {
        [GET]: () => new Response("ok"),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const res = await dispatch(new Request("http://localhost/hello#top"));

    expect(await res.text()).toBe("ok");
  });

  test("lets a longer wildcard route beat the wildcard it extends", async () => {
    const routes: MethodRoutes = {
      "/files/*": {
        [GET]: () => new Response("file"),
      },
      "/files/*/raw": {
        [GET]: () => new Response("raw"),
      },
      "/docs/*": {
        [GET]: () => new Response("doc"),
      },
      "/docs/*/:name": {
        [GET]: (req) => Response.json(req.params),
      },
    };

    const dispatch = buildFetchDispatcher(routes);
    const raw = await dispatch(new Request("http://localhost/files/x/raw"));
    const file = await dispatch(new Request("http://localhost/files/x"));
    const named = await dispatch(new Request("http://localhost/docs/a/b/c"));

    expect(await raw.text()).toBe("raw");
    expect(await file.text()).toBe("file");
    expect(await named.json()).toEqual({ "0": "a/b", name: "c" });
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
