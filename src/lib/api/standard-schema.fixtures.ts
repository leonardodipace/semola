import { type } from "arktype";
import * as v from "valibot";
import { z } from "zod";

export const providers = ["zod", "valibot", "arktype"] as const;

export type Provider = (typeof providers)[number];

export const schemaFor = {
  userWithAge: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({
        user: z.object({ email: z.email() }),
        age: z.number(),
      });
    }

    if (provider === "valibot") {
      return v.object({
        user: v.object({ email: v.pipe(v.string(), v.email()) }),
        age: v.number(),
      });
    }

    return type({
      user: { email: "string.email" },
      age: "number",
    });
  },

  idNumber: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({ id: z.number() });
    }

    if (provider === "valibot") {
      return v.object({ id: v.number() });
    }

    return type({ id: "number" });
  },

  nameString: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({ name: z.string() });
    }

    if (provider === "valibot") {
      return v.object({ name: v.string() });
    }

    return type({ name: "string" });
  },

  nameAndAge: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({ name: z.string(), age: z.number() });
    }

    if (provider === "valibot") {
      return v.object({ name: v.string(), age: v.number() });
    }

    return type({ name: "string", age: "number" });
  },

  queryFilterTags: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({
        filter: z.string(),
        tags: z.array(z.string()),
      });
    }

    if (provider === "valibot") {
      return v.object({
        filter: v.string(),
        tags: v.array(v.string()),
      });
    }

    return type({ filter: "string", tags: "string[]" });
  },

  apiKeyHeader: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({ "x-api-key": z.string() });
    }

    if (provider === "valibot") {
      return v.object({ "x-api-key": v.string() });
    }

    return type({ "x-api-key": "string" });
  },

  themeCookies: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({
        theme: z.enum(["light", "dark"]),
        session: z.string(),
      });
    }

    if (provider === "valibot") {
      return v.object({
        theme: v.picklist(["light", "dark"]),
        session: v.string(),
      });
    }

    return type({ theme: "'light'|'dark'", session: "string" });
  },

  requiredCookie: (provider: Provider) => {
    if (provider === "zod") {
      return z.object({ requiredCookie: z.string() });
    }

    if (provider === "valibot") {
      return v.object({ requiredCookie: v.string() });
    }

    return type({ requiredCookie: "string" });
  },
};

export const validUser = {
  user: { email: "user@example.com" },
  age: 30,
};

export const invalidUser = {
  user: { email: "bad" },
};
