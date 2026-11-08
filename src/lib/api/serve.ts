import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mightThrow, mightThrowSync } from "../errors/index.js";
import { PayloadTooLargeError, UnsupportedRuntimeError } from "./errors.js";
import type { ApiServer, RequestHandler } from "./types.js";

// Routes through api.fetch like every other runtime, so matching and params
// behave the same everywhere.
export const serveWithBun = (port: number, handler: RequestHandler) => {
  const server = Bun.serve({ port, fetch: handler });

  const apiServer: ApiServer = {
    port: server.port ?? port,
    url: server.url,
    stop: (force = false) => server.stop(force),
  };

  return apiServer;
};

const readUrl = (incoming: IncomingMessage) => {
  let target = incoming.url ?? "/";

  // Absolute-form targets (sent through proxies): keep only the path. The
  // connection is plain HTTP whatever scheme or origin the target claims.
  if (!target.startsWith("/")) {
    const absolute = new URL(target);

    target = `${absolute.pathname}${absolute.search}`;
  }

  // Prefix instead of resolving, so "//a/b" stays a path and not a host.
  const url = new URL(`http://localhost${target}`);

  // The host setter ignores invalid values and stops at "/", so the path stays.
  url.host = incoming.headers.host ?? "localhost";

  return url;
};

// Connection-level headers describe one hop, never the message. Node's fetch()
// rejects them (and Expect) in requests, so forwarding c.raw.headers upstream
// would fail; in responses they would override Node's own connection handling.
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "expect",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

// headersDistinct keeps every value. incoming.headers keeps only the first value
// of some repeated headers (authorization, content-type), where Bun joins them.
// Plain pairs, so the Request constructor builds its Headers once.
const readHeaders = (incoming: IncomingMessage) => {
  const headers: [string, string][] = [];

  for (const [name, values] of Object.entries(incoming.headersDistinct)) {
    if (HOP_BY_HOP_HEADERS.has(name)) continue;

    for (const value of values ?? []) {
      headers.push([name, value]);
    }
  }

  return headers;
};

// Bun.serve's default maxRequestBodySize.
export const MAX_BODY_BYTES = 128 * 1024 * 1024;

// How long an oversized upload may keep sending after its 413.
const OVERSIZED_UPLOAD_LINGER_MS = 1000;

// Reads the whole body before the handler runs, so the connection is always
// left ready for the next request. Past MAX_BODY_BYTES it keeps reading but
// drops the rest, so the 413 can go out before the connection is cut.
const readBody = (incoming: IncomingMessage) => {
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    incoming.on("data", (chunk: Buffer) => {
      received += chunk.length;

      if (received > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new PayloadTooLargeError(MAX_BODY_BYTES));
        return;
      }

      chunks.push(chunk);
    });

    // A Blob copies the chunks once; the Request takes it without another copy.
    incoming.once("end", () => resolve(new Blob(chunks)));
    incoming.once("error", reject);
  });
};

const toRequest = (
  incoming: IncomingMessage,
  body: Blob | undefined,
  signal: AbortSignal,
) => {
  const method = incoming.method ?? "GET";
  const init: RequestInit = { method, headers: readHeaders(incoming), signal };

  // Like Bun, a request without a body (or with an empty one) gets a null body.
  if (body?.size) {
    init.body = body;
  }

  return new Request(readUrl(incoming).href, init);
};

// Errors from a client leaving mid-response. Anything else is a failing stream.
const DISCONNECT_CODES = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_DESTROYED",
  "ECONNRESET",
  "EPIPE",
]);

const writeResponse = async (response: Response, res: ServerResponse) => {
  const { Readable } = process.getBuiltinModule("node:stream");
  const { pipeline } = process.getBuiltinModule("node:stream/promises");

  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  // Node manages the connection itself, so a handler's (or a proxied upstream's)
  // Connection or Keep-Alive header must not override it. Iterating Headers
  // yields each Set-Cookie on its own.
  for (const [name, value] of response.headers) {
    if (HOP_BY_HOP_HEADERS.has(name)) continue;

    res.appendHeader(name, value);
  }

  if (!response.body) {
    res.end();
    return;
  }

  // A HEAD answer has no body. Cancel it so a stream (SSE) stops now instead of
  // running until the client hangs up.
  if (res.req.method === "HEAD") {
    res.end();

    // A locked body cannot be cancelled; the answer is already sent either way.
    await mightThrow(response.body.cancel());
    return;
  }

  const body = Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0],
  );

  const [error] = await mightThrow(pipeline(body, res));

  if (!error) return;

  if (DISCONNECT_CODES.has((error as NodeJS.ErrnoException).code ?? "")) return;

  console.error(error);
};

// Node discards the rest of the upload while the client reads the 413; closing
// at once would reset the connection first. Cut it off after a moment so a huge
// upload cannot keep the connection busy.
const refuseOversized = async (
  incoming: IncomingMessage,
  res: ServerResponse,
) => {
  res.once("finish", () => {
    const cutOff = () => {
      if (incoming.complete) return;

      incoming.destroy();
    };

    setTimeout(cutOff, OVERSIZED_UPLOAD_LINGER_MS).unref();
  });

  await writeResponse(new Response("Payload Too Large", { status: 413 }), res);
};

const respond = async (
  handler: RequestHandler,
  incoming: IncomingMessage,
  res: ServerResponse,
) => {
  const disconnect = new AbortController();

  res.once("close", () => {
    if (res.writableFinished) return;

    disconnect.abort();
  });

  // Refuse a declared oversized body without reading any of it.
  if (Number(incoming.headers["content-length"]) > MAX_BODY_BYTES) {
    await refuseOversized(incoming, res);
    return;
  }

  let body: Blob | undefined;

  // fetch() refuses a GET or HEAD body; Node discards one after the response.
  if (incoming.method !== "GET") {
    if (incoming.method !== "HEAD") {
      const [bodyError, buffered] = await mightThrow(readBody(incoming));

      if (bodyError instanceof PayloadTooLargeError) {
        await refuseOversized(incoming, res);
        return;
      }

      // The client left mid-upload; there is no one to answer.
      if (bodyError) return;

      body = buffered;
    }
  }

  // Bad targets and methods fetch forbids (TRACE, CONNECT) throw here.
  const [requestError, request] = mightThrowSync(() => {
    return toRequest(incoming, body, disconnect.signal);
  });

  if (requestError) {
    await writeResponse(new Response("Bad Request", { status: 400 }), res);
    return;
  }

  await writeResponse(await handler(request), res);
};

// Node and runtimes with node:http plus process.getBuiltinModule.
export const serveWithNode = (port: number, handler: RequestHandler) => {
  if (typeof process === "undefined") throw new UnsupportedRuntimeError();
  if (typeof process.getBuiltinModule !== "function") {
    throw new UnsupportedRuntimeError();
  }

  const { createServer } = process.getBuiltinModule("node:http");

  let stopping = false;

  // Handler errors and responses Node cannot send (Response.error() has status
  // 0) land here, so one bad request never crashes the process.
  const server = createServer(async (incoming, res) => {
    // While stopping, close each connection once its response is done, so a
    // graceful stop does not wait out the keep-alive timeout.
    res.once("finish", () => {
      if (!stopping) return;

      server.closeIdleConnections();
    });

    const [error] = await mightThrow(respond(handler, incoming, res));

    // null marks success. A handler can reject with undefined, which still
    // needs a 500.
    if (error === null) return;

    // The client left, so the handler failing (often on req.signal) is expected.
    if (res.destroyed) return;

    console.error(error);

    if (res.headersSent) {
      res.destroy();
      return;
    }

    // Drop headers the failed response already set, then answer directly so
    // this fallback cannot fail the same way.
    for (const name of res.getHeaderNames()) {
      res.removeHeader(name);
    }

    res.statusCode = 500;
    res.statusMessage = "Internal Server Error";
    res.end("Internal Server Error");
  });

  // close() waits for in-flight requests. Idle keep-alive connections would hold
  // it open, so drop them too (Node does this itself from v19, Bun's does not).
  const stop = (force = false) => {
    stopping = true;

    return new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();

      if (force) {
        server.closeAllConnections();
      }
    });
  };

  return new Promise<ApiServer>((resolve, reject) => {
    server.once("error", reject);

    server.listen(port, () => {
      server.off("error", reject);

      // Log later server errors (EMFILE on accept) instead of crashing.
      server.on("error", (error) => console.error(error));

      // Listening on a TCP port, so address() is never a pipe name.
      const { port: boundPort } = server.address() as AddressInfo;

      resolve({
        port: boundPort,
        url: new URL(`http://localhost:${boundPort}/`),
        stop,
      });
    });
  });
};
