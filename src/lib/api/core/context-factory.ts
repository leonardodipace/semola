import { html, json, redirect, text } from "./response-helpers.js";
import type { InternalContext, ValidatedRequest } from "./types.js";

const emptyValidated: ValidatedRequest = Object.freeze({
  body: undefined,
  query: undefined,
  headers: undefined,
  cookies: undefined,
  params: undefined,
});

const sharedContext = {
  req: emptyValidated,
  get: () => {
    return undefined;
  },
  json,
  text,
  html,
  redirect,
};

export const createContext = (
  req: Bun.BunRequest,
  validated?: ValidatedRequest,
  get?: (key: string) => unknown,
  jsonHandler?: (status: number, data: unknown) => Response,
): InternalContext => {
  const context = Object.create(sharedContext) as InternalContext;
  context.raw = req;

  if (validated) {
    context.req = validated;
  }

  if (get) {
    context.get = get;
  }

  if (jsonHandler) {
    context.json = jsonHandler;
  }

  return context;
};

export const getEmptyValidated = () => {
  return emptyValidated;
};
