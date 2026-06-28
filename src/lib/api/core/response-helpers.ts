import { ParseError, ValidationError } from "../errors.js";
import { validateSchema } from "../validation/index.js";
import type { ResponseSchema } from "./types.js";

const htmlHeaders = { "Content-Type": "text/html" };
const badRequestInit = { status: 400 };

// Status 200 uses default Response constructors to avoid init object allocation
// and the general constructor path on every request.
export const json = (status: number, data: unknown) => {
  if (status === 200) return Response.json(data);

  return Response.json(data, { status });
};

export const text = (status: number, body: string) => {
  if (status === 200) return new Response(body);

  return new Response(body, { status });
};

export const html = (status: number, body: string) => {
  return new Response(body, {
    status,
    headers: htmlHeaders,
  });
};

export const redirect = (status: number, url: string) => {
  return Response.redirect(url, status);
};

export const badRequest = (message?: string) => {
  return Response.json({ message }, badRequestInit);
};

export const mapValidationError = (error: Error) => {
  if (error instanceof ValidationError) return badRequest(error.message);
  if (error instanceof ParseError) return badRequest(error.message);

  throw error;
};

export const validatingJson = (responseSchema: ResponseSchema) => {
  return (status: number, data: unknown) => {
    const schema = responseSchema[status];

    if (!schema) return json(status, data);

    try {
      validateSchema(schema, data);
    } catch (error) {
      return mapValidationError(error as Error);
    }

    return json(status, data);
  };
};
