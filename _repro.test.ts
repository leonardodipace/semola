import { test, expect } from "bun:test";
import { array, object, string, record, tuple, number, union } from "./src/lib/schema/index.js";

const p = (label: string, r: any) => console.log(label, JSON.stringify(r.error?.issues));

test("scoping", () => {
  p("array->obj:", array(object({ name: string() })).safeParse([{ name: 123 }]));
  p("obj->array->obj:", object({ items: array(object({ name: string() })) }).safeParse({ items: [{ name: 123 }] }));
  p("union->obj (nested in obj):", object({ v: union([object({ a: string() }), number()]) }).safeParse({ v: { a: 1 } }));
  p("array of primitive (control):", array(string()).safeParse(["ok", 123]));
  p("top-level obj (control):", object({ name: string() }).safeParse({ name: 123 }));
  p("array->obj non-object element:", array(object({ name: string() })).safeParse([5]));
  p("nested obj in obj (control, inlined):", object({ a: object({ name: string() }) }).safeParse({ a: { name: 123 } }));
});
