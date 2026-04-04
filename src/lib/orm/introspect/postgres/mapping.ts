import { mapColumns } from "./mapping/columns.js";

export function buildEnumMap(rows: [string, string][]) {
  const enumMap = new Map<string, string[]>();

  for (const [typeName, enumLabel] of rows) {
    const key = typeName.toLowerCase();
    const labels = enumMap.get(key);

    if (labels) {
      labels.push(enumLabel);
      continue;
    }

    enumMap.set(key, [enumLabel]);
  }

  return enumMap;
}
export { mapColumns };
