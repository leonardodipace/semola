export function toCamelCase(sqlName: string) {
  return sqlName.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

export function toPascalCase(sqlName: string) {
  const camel = toCamelCase(sqlName);
  const first = camel[0];

  if (!first) {
    return camel;
  }

  return `${first.toUpperCase()}${camel.slice(1)}`;
}

export function toTypeLiteral(value: string) {
  return JSON.stringify(value);
}

export function buildEnumValues(values: string[]) {
  return `[${values.map((value) => toTypeLiteral(value)).join(", ")}]`;
}

export function toVarName(tableName: string) {
  const camel = toCamelCase(tableName);
  return `${camel}Table`;
}

export function toOneRelationBaseName(sqlName: string) {
  if (sqlName.endsWith("_id") && sqlName.length > 3) {
    return sqlName.slice(0, -3);
  }

  return sqlName;
}

export function toUniqueRelationKey(
  baseKey: string,
  used: Set<string>,
  suffix: string,
) {
  if (!used.has(baseKey)) {
    used.add(baseKey);
    return baseKey;
  }

  const suffixed = `${baseKey}By${toPascalCase(suffix)}`;

  if (!used.has(suffixed)) {
    used.add(suffixed);
    return suffixed;
  }

  let index = 2;

  while (used.has(`${suffixed}${index}`)) {
    index++;
  }

  const indexed = `${suffixed}${index}`;
  used.add(indexed);
  return indexed;
}
