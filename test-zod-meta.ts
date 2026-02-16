import { z } from "zod";

// Test 1: Schema with meta id
const UserSchema = z.object({ id: z.string(), name: z.string() }).meta({ id: "User" });

const std = UserSchema["~standard"];
console.log("Has standard:", !!std);
console.log("Standard object keys:", Object.keys(std || {}));
console.log("jsonSchema type:", typeof std?.jsonSchema);
console.log("jsonSchema:", std?.jsonSchema);

if (std?.jsonSchema && typeof std.jsonSchema === 'object') {
  const inputSchema = std.jsonSchema.input?.({ target: "draft-2020-12" }) || std.jsonSchema;
  console.log("Input JSON Schema:", JSON.stringify(inputSchema, null, 2));
}

// Test 2: Schema without meta id
const PostSchema = z.object({ title: z.string() });
const postStd = PostSchema["~standard"];
if (postStd?.jsonSchema) {
  const postInputSchema = postStd.jsonSchema.input({ target: "draft-2020-12" });
  console.log("Post JSON Schema:", JSON.stringify(postInputSchema, null, 2));
}

// Test 3: Check if meta is accessible from standard
console.log("\nChecking for meta in standard object:");
console.log("Standard keys:", Object.keys(std || {}));
console.log("Standard metadata:", std);
