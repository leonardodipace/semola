import { describe, expect, test } from "bun:test";
import { PlaceholderGenerator } from "./placeholder.js";
import { POSTGRES_SPEC } from "./postgres.js";
import { SQLITE_SPEC } from "./sqlite.js";

describe("placeholder", () => {
  test("creates dialect placeholders", () => {
    const sqlite = new PlaceholderGenerator(SQLITE_SPEC).asFn();
    const postgres = new PlaceholderGenerator(POSTGRES_SPEC).asFn();

    expect([sqlite(), sqlite()]).toEqual(["?", "?"]);
    expect([postgres(), postgres()]).toEqual(["$1", "$2"]);
  });
});
