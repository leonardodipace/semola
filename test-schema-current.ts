import { z } from "zod";
import { generateOpenApiSpec } from "./src/lib/api/openapi/index.js";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

const spec = await generateOpenApiSpec({
  title: "Test API",
  version: "1.0.0",
  routes: [
    {
      path: "/users",
      method: "POST",
      request: { body: UserSchema },
      response: { 201: UserSchema },
      handler: () => {},
    },
    {
      path: "/users/:id",
      method: "GET",
      request: { params: z.object({ id: z.string() }) },
      response: { 200: UserSchema },
      handler: () => {},
    },
  ],
});

console.log(JSON.stringify(spec, null, 2));
