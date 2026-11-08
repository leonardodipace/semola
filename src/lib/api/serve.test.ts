import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { z } from "zod";
import { Api } from "./api.js";
import { MAX_BODY_BYTES, serveWithNode } from "./serve.js";
import type { ApiServer } from "./types.js";

let server: ApiServer | undefined;

afterEach(async () => {
  mock.restore();
  await server?.stop(true);
  server = undefined;
});

const createApi = () => {
  const api = new Api();

  api.defineRoute({
    path: "/users/:id",
    method: "GET",
    request: { params: z.object({ id: z.string() }) },
    handler: (c) => c.json(200, { id: c.req.params.id }),
  });

  api.defineRoute({
    path: "/echo",
    method: "POST",
    request: { body: z.object({ name: z.string() }) },
    handler: (c) => c.json(200, c.req.body),
  });

  return api;
};

// fetch() resolves "//a/b" against the base URL and refuses to fake
// Content-Length, so send these requests through node:http directly.
const rawRequest = (
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
) => {
  const { request } = process.getBuiltinModule("node:http");

  return new Promise<string>((resolve, reject) => {
    const req = request({ port, path, ...options }, async (res) => {
      let text = "";

      for await (const chunk of res) {
        text += chunk;
      }

      resolve(`${res.statusCode} ${text}`);
    });

    req.on("error", reject);
    req.end();
  });
};

describe("serveWithNode", () => {
  test("routes requests through the fetch handler", async () => {
    server = await serveWithNode(0, createApi().fetch);

    const res = await fetch(new URL("/users/42", server.url));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
  });

  test("passes the request body to the handler", async () => {
    server = await serveWithNode(0, createApi().fetch);

    const res = await fetch(new URL("/echo", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Ada" });
  });

  test("keeps every Set-Cookie header", async () => {
    server = await serveWithNode(0, () => {
      const headers = new Headers();
      headers.append("Set-Cookie", "a=1");
      headers.append("Set-Cookie", "b=2");

      return new Response(null, { headers });
    });

    const res = await fetch(server.url);

    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  test("forwards request headers", async () => {
    server = await serveWithNode(0, (req) => {
      return new Response(req.headers.get("x-trace"));
    });

    const res = await fetch(server.url, { headers: { "X-Trace": "abc" } });

    expect(await res.text()).toBe("abc");
  });

  test("responds 500 when the handler throws", async () => {
    spyOn(console, "error").mockImplementation(() => {});

    server = await serveWithNode(0, () => {
      throw new Error("boom");
    });

    const res = await fetch(server.url);

    expect(res.status).toBe(500);
  });

  test("responds 500 to a Response Node cannot send and keeps serving", async () => {
    spyOn(console, "error").mockImplementation(() => {});

    server = await serveWithNode(0, () => Response.error());

    const first = await fetch(server.url);
    const second = await fetch(server.url);

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
  });

  test("keeps a custom status text", async () => {
    server = await serveWithNode(0, () => {
      return new Response(null, {
        status: 409,
        statusText: "Version Mismatch",
      });
    });

    const res = await fetch(server.url);

    expect(res.statusText).toBe("Version Mismatch");
  });

  test("gives a bodyless request a null body", async () => {
    server = await serveWithNode(0, (req) => {
      return new Response(String(req.body === null));
    });

    const res = await fetch(server.url, { method: "DELETE" });

    expect(await res.text()).toBe("true");
  });

  test("drops headers from a response that failed to send", async () => {
    spyOn(console, "error").mockImplementation(() => {});

    server = await serveWithNode(0, () => {
      const response = new Response("locked", {
        headers: { "Set-Cookie": "session=x" },
      });

      response.body?.getReader();

      return response;
    });

    const res = await fetch(server.url);

    expect(res.status).toBe(500);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.text()).toBe("Internal Server Error");
  });

  test("refuses a declared body over the size limit", async () => {
    server = await serveWithNode(0, () => new Response("read"));

    const body = await rawRequest(server.port, "/", {
      method: "POST",
      headers: { "content-length": String(MAX_BODY_BYTES + 1) },
    });

    expect(body).toBe("413 Payload Too Large");
  });

  test("refuses a chunked body once it passes the size limit", async () => {
    const { request } = process.getBuiltinModule("node:http");

    server = await serveWithNode(0, () => new Response("read"));

    const port = server.port;
    const megabyte = Buffer.alloc(1024 * 1024);

    const status = await new Promise<number | undefined>((resolve) => {
      const req = request({ port, method: "POST" }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });

      req.on("error", () => resolve(undefined));

      // No Content-Length, so Node sends the body chunked, without end.
      const pump = () => {
        while (req.write(megabyte)) {
          // Keep writing until the socket pushes back.
        }

        req.once("drain", pump);
      };

      pump();
    });

    expect(status).toBe(413);
  });

  test("answers HEAD even when the body cannot be cancelled", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});

    server = await serveWithNode(0, () => {
      const response = new Response("locked");

      response.body?.getReader();

      return response;
    });

    const res = await fetch(server.url, { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(logged).not.toHaveBeenCalled();
  });

  test("keeps only the path of a proxy-style request target", async () => {
    server = await serveWithNode(0, (req) => new Response(req.url));

    const body = await rawRequest(server.port, "https://evil.example/a?b=1", {
      headers: { host: "api.test" },
    });

    expect(body).toBe("200 http://api.test/a?b=1");
  });

  test("lets in-flight requests finish on a graceful stop", async () => {
    server = await serveWithNode(0, async () => {
      await Bun.sleep(100);

      return new Response("finished");
    });

    const pending = fetch(server.url);

    await Bun.sleep(20);

    const stopped = server.stop();
    const res = await pending;

    await stopped;
    server = undefined;

    expect(await res.text()).toBe("finished");
  });

  test("responds 500 when the handler rejects with no reason", async () => {
    spyOn(console, "error").mockImplementation(() => {});

    server = await serveWithNode(0, () => Promise.reject());

    const res = await fetch(server.url);

    expect(res.status).toBe(500);
  });

  test("aborts the request signal when the client disconnects", async () => {
    const { promise: aborted, resolve } = Promise.withResolvers<void>();

    server = await serveWithNode(0, (req) => {
      req.signal.addEventListener("abort", () => resolve());

      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hi"));
        },
      });

      return new Response(body);
    });

    const slowClient = new AbortController();
    const slow = fetch(new URL("/slow", server.url), {
      signal: slowClient.signal,
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    slowClient.abort();
    await slow;

    const client = new AbortController();
    await fetch(server.url, { signal: client.signal });
    client.abort();

    await aborted;
  });

  test("keeps a leading double slash in the path", async () => {
    server = await serveWithNode(0, (req) => {
      return new Response(new URL(req.url).pathname);
    });

    const body = await rawRequest(server.port, "//admin/users");

    expect(body).toBe("200 //admin/users");
  });

  test("ignores a Host header that tries to inject a path", async () => {
    server = await serveWithNode(0, (req) => {
      return new Response(new URL(req.url).pathname);
    });

    const body = await rawRequest(server.port, "/users", {
      headers: { host: "evil/admin" },
    });

    expect(body).toBe("200 /users");
  });

  test("rejects when the port is taken", async () => {
    server = await serveWithNode(0, createApi().fetch);

    await expect(
      serveWithNode(server.port, createApi().fetch),
    ).rejects.toThrow();
  });
});

describe("Api.serve", () => {
  test("routes through api.fetch, so later routes and trailing slashes match", async () => {
    const api = createApi();
    server = await api.serve(0);

    api.defineRoute({ path: "/late", method: "GET", handler: () => "late" });

    const res = await fetch(new URL("/late/", server.url));

    expect(await res.text()).toBe("late");
  });

  test("answers HEAD on a GET route without a body", async () => {
    server = await createApi().serve(0);

    const res = await fetch(new URL("/users/1", server.url), {
      method: "HEAD",
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("rejects at startup when routes are misconfigured", async () => {
    const api = createApi();

    api.defineRoute({ path: "/echo", method: "POST", handler: () => "again" });

    await expect(api.serve(0)).rejects.toThrow();
  });

  test("rejects instead of throwing when the port is taken", async () => {
    server = await createApi().serve(0);

    const second = createApi().serve(server.port);

    await expect(second).rejects.toThrow();
  });
});

// Bun's node:http is an emulation, so check the adapter on the real thing too.
const NODE_CHECK = `
import http from "node:http";
import { Api } from "./index.js";

const logged = [];
console.error = (error) => logged.push(error.message);

const api = new Api();
api.defineRoute({ path: "/upload", method: "POST", handler: () => new Response("no", { status: 401 }) });
api.defineRoute({ path: "/ok", method: "GET", handler: () => "ok" });
api.defineRoute({ path: "/slow-stream", method: "GET", handler: () => new Response(new ReadableStream({
  async start(controller) {
    controller.enqueue(new TextEncoder().encode("a"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.enqueue(new TextEncoder().encode("b"));
    controller.close();
  },
})) });
api.defineRoute({ path: "/hop", method: "GET", handler: () => new Response("hop", {
  headers: { connection: "close", "keep-alive": "timeout=1" },
}) });
api.defineRoute({ path: "/slow-ok", method: "GET", handler: async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return "finished";
} });
let server;
api.defineRoute({ path: "/sink", method: "POST", handler: async (c) => String((await c.raw.arrayBuffer()).byteLength) });
api.defineRoute({ path: "/proxy", method: "POST", handler: (c) => fetch(new URL("/sink", server.url), {
  method: "POST",
  headers: c.raw.headers,
  body: c.raw.body,
  duplex: "half",
}) });
api.defineRoute({ path: "/auth", method: "GET", handler: (c) => c.raw.headers.get("authorization") });
api.defineRoute({ path: "/slow", method: "GET", handler: (c) => new Promise((_, reject) => {
  c.raw.signal.addEventListener("abort", () => reject(new Error("aborted by client")));
}) });
api.defineRoute({ path: "/files/:owner/*", method: "GET", handler: (c) => Response.json(c.raw.params) });
api.defineRoute({ path: "/fail", method: "GET", handler: () => new Response(new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("partial"));
    controller.error(new Error("stream failed"));
  },
})) });
api.defineSSERoute({ path: "/events", handler: async function* () {
  while (true) {
    yield { data: "tick" };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
} });

server = await api.serve(0);
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const send = (method, path, body, headers) => new Promise((resolve, reject) => {
  const req = http.request({ port: server.port, method, path, agent, headers }, async (res) => {
    let text = "";
    for await (const chunk of res) text += chunk;
    resolve(res.statusCode + " " + text);
  });
  req.setTimeout(2000, () => req.destroy(new Error("timeout")));
  req.on("error", (error) => resolve("error " + error.message));
  req.end(body);
});

const oversized = () => new Promise((resolve) => {
  const headers = { "content-length": String(200 * 1024 * 1024) };
  const req = http.request({ port: server.port, method: "POST", path: "/upload", headers }, (res) => {
    res.resume();
    resolve(String(res.statusCode));
  });
  req.on("error", (error) => resolve("error " + error.message));
  const chunk = Buffer.alloc(1024 * 1024);
  let sent = 0;
  const pump = () => {
    while (sent < 32) {
      sent++;
      if (!req.write(chunk)) {
        req.once("drain", pump);
        return;
      }
    }
  };
  pump();
});

const result = {};
result.oversized = await oversized();
result.hopHeaders = await new Promise((resolve) => {
  http.get({ port: server.port, path: "/hop", agent }, (res) => {
    res.resume();
    resolve(res.headers.connection + " " + res.headers["keep-alive"]);
  });
});
const proxied = await fetch(new URL("/proxy", server.url), {
  method: "POST",
  body: new Blob(["hello"]).stream(),
  duplex: "half",
});
result.proxied = proxied.status + " " + (await proxied.text());
result.unreadBody = await send("POST", "/upload", Buffer.alloc(4 * 1024 * 1024));
result.keepAlive = await send("GET", "/ok");
result.trace = await send("TRACE", "/ok");
result.params = await send("GET", "/files/a%20b/x/y");
result.headEvents = await send("HEAD", "/events");
result.repeatedHeader = await send("GET", "/auth", undefined, { authorization: ["one", "two"] });
await send("GET", "/fail");

const client = new AbortController();
const events = await fetch(new URL("/events", server.url), { signal: client.signal });
await events.body.getReader().read();
client.abort();
await new Promise((resolve) => setTimeout(resolve, 100));

result.logged = logged;
agent.destroy();

const inFlight = fetch(new URL("/slow-ok", server.url)).then((res) => res.text());
const inFlightStream = fetch(new URL("/slow-stream", server.url)).then((res) => res.text());
await new Promise((resolve) => setTimeout(resolve, 50));
const stopStarted = Date.now();
const stopped = server.stop();
result.gracefulStop = [await inFlight, await inFlightStream];
await stopped;
result.stoppedQuickly = Date.now() - stopStarted < 2000;
console.log(JSON.stringify(result));
`;

describe.skipIf(!Bun.which("node"))("on real Node", () => {
  test("serves through node:http", async () => {
    const { mkdtemp, rm, writeFile } =
      process.getBuiltinModule("node:fs/promises");
    const { tmpdir } = process.getBuiltinModule("node:os");
    const { join } = process.getBuiltinModule("node:path");
    const dir = await mkdtemp(join(tmpdir(), "semola-api-node-"));

    await Bun.build({
      entrypoints: [join(import.meta.dir, "index.ts")],
      outdir: dir,
      target: "node",
    });

    await writeFile(join(dir, "check.mjs"), NODE_CHECK);

    const child = Bun.spawn(["node", join(dir, "check.mjs")], {
      stdout: "pipe",
    });
    const output = await new Response(child.stdout).text();

    await rm(dir, { recursive: true, force: true });

    expect(JSON.parse(output)).toEqual({
      oversized: "413",
      hopHeaders: "keep-alive timeout=5",
      gracefulStop: ["finished", "ab"],
      stoppedQuickly: true,
      proxied: "200 5",
      unreadBody: "401 no",
      keepAlive: "200 ok",
      trace: "400 Bad Request",
      params: '200 {"0":"x/y","owner":"a b"}',
      headEvents: "200 ",
      repeatedHeader: "200 one, two",
      logged: ["stream failed"],
    });
  }, 30_000);
});
