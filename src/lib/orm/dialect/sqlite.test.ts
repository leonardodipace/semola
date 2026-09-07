import { describe, expect, test } from "bun:test";
import { getDialect } from "./index.js";
import { usersTable } from "./test-fixtures.js";

describe("sqlite dialect", () => {
  test("reports sqlite as its name", () => {
    const dialect = getDialect({
      adapter: "sqlite",
      table: usersTable,
      relations: {},
    });

    expect(dialect.name).toBe("sqlite");
  });
});
