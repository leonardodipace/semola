import type { StandardSchemaV1 } from "@standard-schema/spec";

export type CLIConfig = {
  name: string;
  description?: string;
  version?: string;
};

export type ArgumentConfig = {
  name: string;
  schema: StandardSchemaV1;
};

export type OptionConfig = {
  name: string;
  schema: StandardSchemaV1;
  aliases?: string[];
};

export type OptionDef = {
  name: string;
  aliases?: string[];
};

type SafeTypeAccess<
  T,
  K extends "input" | "output",
> = T extends StandardSchemaV1
  ? T["~standard"] extends { types?: infer U }
    ? U extends Record<K, infer V>
      ? V
      : never
    : never
  : undefined;

export type InferOutput<T extends StandardSchemaV1> = SafeTypeAccess<
  T,
  "output"
>;

export type ParsedArgv = {
  positional: string[];
  options: Record<string, string | true>;
};
