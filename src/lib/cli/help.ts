import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import type { ArgumentConfig, OptionConfig, UsageEntry } from "./types.js";

const helpOption: UsageEntry = {
  label: "-h, --help",
  description: "Show help",
};

const versionOption: UsageEntry = {
  label: "-v, --version",
  description: "Show version",
};

export const globalOptions: UsageEntry[] = [helpOption, versionOption];

export const commandHelpOptions: UsageEntry[] = [helpOption];

const hasToken = (token: string | undefined, values: readonly string[]) => {
  if (!token) return false;
  if (!values.includes(token)) return false;

  return true;
};

export const isHelpToken = (token: string | undefined) => {
  return hasToken(token, ["--help", "-h"]);
};

export const isVersionToken = (token: string | undefined) => {
  return hasToken(token, ["--version", "-v"]);
};

export const formatArgumentPlaceholders = (arguments_: ArgumentConfig[]) => {
  return arguments_.map((argument) => `<${argument.name}>`).join(" ");
};

type CommandListEntry = {
  arguments: ArgumentConfig[];
  description?: string;
};

export const formatCommandListLines = (
  commands: Map<string, CommandListEntry>,
) => {
  return Array.from(commands, ([name, command]) => {
    const argNames = formatArgumentPlaceholders(command.arguments);
    const parts = [name, argNames].filter((part) => part.length > 0);
    if (!command.description) return `  ${parts.join(" ")}`;

    return `  ${parts.join(" ")}  ${command.description}`;
  });
};

const formatOptionFlags = (option: OptionConfig) => {
  const aliases = option.aliases ?? [];
  const formattedAliases = aliases.map((alias) => `-${alias}`);
  const formattedName = `--${option.name}`;

  const flags = [...formattedAliases, formattedName];

  return flags.join(", ");
};

export const formatOptionUsageEntry = (option: OptionConfig): UsageEntry => {
  const label = formatOptionFlags(option);
  const description = getSchemaDescription(option.schema);

  return { label, description };
};

export const formatUsageEntries = (entries: UsageEntry[]) => {
  const described = entries.filter((entry) => entry.description);
  const labelWidth = described.reduce(
    (width, entry) => Math.max(width, entry.label.length),
    0,
  );

  return entries.map((entry) => {
    if (!entry.description) {
      return `  ${entry.label}`;
    }

    return `  ${entry.label.padEnd(labelWidth)}  ${entry.description}`;
  });
};

export const getSchemaDescription = (schema: StandardSchemaV1) => {
  const standard = schema["~standard"];

  if (!("jsonSchema" in standard)) {
    return "";
  }

  const { description } = (schema as unknown as StandardJSONSchemaV1)[
    "~standard"
  ].jsonSchema.input({ target: "draft-2020-12" });

  if (typeof description !== "string") {
    return "";
  }

  return description;
};

export const printDescription = (description: string | undefined) => {
  if (!description) {
    return;
  }

  console.log(`${description}\n`);
};
