import { describe, expect, test } from "bun:test";
import { parseArgv } from "./parser.js";

describe("parseArgv", () => {
  const optionDefs = [
    { name: "separator", aliases: [] as string[] },
    { name: "first" },
    { name: "tag", aliases: ["t"] },
  ];

  test("extracts positional arguments", () => {
    const parsed = parseArgv(["Hello, world!", "extra"], optionDefs);

    expect(parsed.positional).toEqual(["Hello, world!", "extra"]);
    expect(parsed.options).toEqual({});
  });

  test("treats tokens after -- as positional", () => {
    const parsed = parseArgv(["--", "--first", "value"], optionDefs);

    expect(parsed.positional).toEqual(["--first", "value"]);
    expect(parsed.options).toEqual({});
  });

  test("parses --name value long options", () => {
    const parsed = parseArgv(["--separator", ","], optionDefs);

    expect(parsed.options).toEqual({ separator: "," });
  });

  test("parses --name=value long options", () => {
    const parsed = parseArgv(["--separator=,"], optionDefs);

    expect(parsed.options).toEqual({ separator: "," });
  });

  test("parses bare boolean long options", () => {
    const parsed = parseArgv(["--first"], optionDefs);

    expect(parsed.options).toEqual({ first: true });
  });

  test("parses short alias with separate value", () => {
    const parsed = parseArgv(["-t", "v1.0.0"], optionDefs);

    expect(parsed.options).toEqual({ tag: "v1.0.0" });
  });

  test("parses short alias with equals value", () => {
    const parsed = parseArgv(["-t=v1.0.0"], optionDefs);

    expect(parsed.options).toEqual({ tag: "v1.0.0" });
  });

  test("parses multi-character alias with separate value", () => {
    const defs = [{ name: "tag", aliases: ["pkg"] }];
    const parsedNormal = parseArgv(["--tag", "v1.0.0"], defs);
    const parsedAlias = parseArgv(["-pkg", "v1.0.0"], defs);

    expect(parsedNormal.options).toEqual({ tag: "v1.0.0" });
    expect(parsedAlias.options).toEqual({ tag: "v1.0.0" });
  });

  test("rejects glued short alias values", () => {
    expect(() => parseArgv(["-tv1.0.0"], optionDefs)).toThrow(
      "Unknown option: -tv1.0.0",
    );
  });

  test("rejects glued long alias values", () => {
    expect(() => parseArgv(["-tagv1.0.0"], optionDefs)).toThrow(
      "Unknown option: -tagv1.0.0",
    );
  });

  test("rejects glued option values", () => {
    expect(() => parseArgv(["--tagv1.0.0"], optionDefs)).toThrow(
      "Unknown option: --tagv1.0.0",
    );
  });

  test("throws on unknown options", () => {
    expect(() => parseArgv(["--unknown"], optionDefs)).toThrow(
      "Unknown option: --unknown",
    );
  });

  test("throws on unknown multi-character short options", () => {
    expect(() => parseArgv(["-pkg"], optionDefs)).toThrow(
      "Unknown option: -pkg",
    );
  });

  test("throws on unknown options with separeted value", () => {
    expect(() => parseArgv(["--unknown", "10"], optionDefs)).toThrow(
      "Unknown option: --unknown",
    );
  });

  test("throws on unknown options with equals", () => {
    expect(() => parseArgv(["--unknown=10"], optionDefs)).toThrow(
      "Unknown option: --unknown",
    );
  });
});
