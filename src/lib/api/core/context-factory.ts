import {
  html,
  json,
  redirect,
  text,
  validatingJson,
} from "./response-helpers.js";
import type {
  CreateContextInput,
  CreateContextWithBodyInput,
  InternalContext,
  ValidatedRequest,
} from "./types.js";

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

export class ContextFactory {
  public create(input: CreateContextInput): InternalContext {
    const context = Object.create(sharedContext) as InternalContext;
    context.raw = input.req;

    if (input.validated) {
      context.req = input.validated;
    }

    if (input.extensions) {
      context.get = (key: string) => {
        return input.extensions?.[key];
      };
    }

    if (input.validateOutput && input.response) {
      context.json = validatingJson(input.response);
    }

    return context;
  }

  public createWithBody(input: CreateContextWithBodyInput): InternalContext {
    const context = Object.create(sharedContext) as InternalContext &
      ValidatedRequest;
    context.raw = input.req;
    context.body = input.body;
    // One allocation: context.req.body reads from the same object as context.body.
    context.req = context;

    return context;
  }

  public getEmptyValidated() {
    return emptyValidated;
  }
}

export const sharedContextFactory = new ContextFactory();
