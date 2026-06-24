import type { ArgumentConfig, OptionConfig } from "./types.js";

export const globalOptionLines = [
  "  -h, --help       Show help",
  "  -v, --version    Show version",
] as const;

export const formatArgumentPlaceholders = (arguments_: ArgumentConfig[]) => {
  return arguments_.map((argument) => `<${argument.name}>`).join(" ");
};

export const formatOptionFlags = (option: OptionConfig) => {
  const flags = [
    ...(option.aliases ?? []).map((alias) => `-${alias}`),
    `--${option.name}`,
  ];

  return flags.join(", ");
};
