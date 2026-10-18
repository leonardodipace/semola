import { expect, test } from "bun:test";
import { array, date, object, string } from "./index.js";

test("array of mixed-field object (needsPath true): inlined field path", () => {
  // name inlines (static path), d does not inline (date) -> needsPath true run
  const schema = array(object({ name: string(), d: date() }));
  const r = schema.safeParse([{ name: 123, d: new Date() }]);
  if (r.success) throw new Error("expected failure");
  console.log("MIXED paths:", JSON.stringify(r.error.issues.map((i) => i.path)));
  expect(r.error.issues[0]?.path).toEqual([0, "name"]);
});

test("array of mixed-field object: non-inlined field path", () => {
  const schema = array(object({ name: string(), d: date() }));
  const r = schema.safeParse([{ name: "ok", d: "not-a-date" }]);
  if (r.success) throw new Error("expected failure");
  console.log("MIXED2 paths:", JSON.stringify(r.error.issues.map((i) => i.path)));
  expect(r.error.issues[0]?.path).toEqual([0, "d"]);
});
