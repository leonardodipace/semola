import type { StandardSchemaV1 } from "@standard-schema/spec";
import { CliValidationError, MissingArgumentError } from "./errors.js";
import type { ArgumentConfig, OptionConfig } from "./types.js";

export const validateValue = async (
  schema: StandardSchemaV1,
  raw: unknown,
  fieldName: string,
) => {
  const result = await schema["~standard"].validate(raw);

  if (!result.issues) {
    return result.value;
  }

  const issues = result.issues.map((issue) => {
    let path = fieldName;

    if (Array.isArray(issue.path)) {
      const suffix = issue.path.map(String).join(".");

      if (suffix.length > 0) {
        path = `${fieldName}.${suffix}`;
      }
    }

    return `${path}: ${issue.message ?? "validation failed"}`;
  });

  throw new CliValidationError(issues.join(", "));
};

export const validateArguments = async (
  defs: ArgumentConfig[],
  positional: string[],
) => {
  if (positional.length < defs.length) {
    const missingDef = defs[positional.length];

    if (!missingDef) {
      throw new MissingArgumentError("Missing argument");
    }

    throw new MissingArgumentError(`Missing argument: ${missingDef.name}`);
  }

  const args: Record<string, unknown> = {};

  for (const [index, def] of defs.entries()) {
    args[def.name] = await validateValue(
      def.schema,
      positional[index],
      def.name,
    );
  }

  return args;
};

export const validateOptions = async (
  defs: OptionConfig[],
  raw: Record<string, string | true>,
) => {
  const options: Record<string, unknown> = {};

  for (const def of defs) {
    const rawValue = raw[def.name];

    options[def.name] = await validateValue(def.schema, rawValue, def.name);
  }

  return options;
};
