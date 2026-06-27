import { mightThrowSync } from "../../errors/index.js";
import { validateSchema } from "../validation/index.js";
import type { ResponseSchema } from "./types.js";

// Status 200 uses default Response constructors to avoid init object allocation
// and the general constructor path on every request.
export const json = (status: number, data: unknown) => {
  if (status === 200) {
    return Response.json(data);
  }

  return Response.json(data, { status });
};

export const text = (status: number, body: string) => {
  if (status === 200) {
    return new Response(body);
  }

  return new Response(body, { status });
};

export const html = (status: number, body: string) => {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html" },
  });
};

export const redirect = (status: number, url: string) => {
  return Response.redirect(url, status);
};

export const badRequest = (message?: string) => {
  return Response.json({ message }, { status: 400 });
};

export const validatingJson = (responseSchema: ResponseSchema) => {
  return (status: number, data: unknown) => {
    const schema = responseSchema[status];

    if (!schema) {
      return json(status, data);
    }

    const [error] = mightThrowSync(() => {
      validateSchema(schema, data);
    });

    if (error) {
      return badRequest(error.message);
    }

    return json(status, data);
  };
};
