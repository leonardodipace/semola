export function buildEnumMap(rows: [string, string][]) {
  const enumMap = new Map<string, string[]>();

  for (const [typeName, enumLabel] of rows) {
    const labels = enumMap.get(typeName);

    if (labels) {
      labels.push(enumLabel);
      continue;
    }

    enumMap.set(typeName, [enumLabel]);
  }

  return enumMap;
}
