export function isDialect(value: unknown) {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

export function isTableLike(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (typeof Reflect.get(value, "tableName") !== "string") {
    return false;
  }

  const columns = Reflect.get(value, "columns");

  if (typeof columns !== "object" || columns === null) {
    return false;
  }

  return true;
}

export function isModelLike(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!isDialect(Reflect.get(value, "dialect"))) {
    return false;
  }

  if (!isTableLike(Reflect.get(value, "table"))) {
    return false;
  }

  return true;
}

export function isOrmLike(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const options = Reflect.get(value, "options");

  if (typeof options !== "object" || options === null) {
    return false;
  }

  if (typeof Reflect.get(options, "url") !== "string") {
    return false;
  }

  if (!isDialect(Reflect.get(value, "dialect"))) {
    return false;
  }

  const tables = Reflect.get(value, "tables");

  if (typeof tables !== "object" || tables === null) {
    return false;
  }

  return true;
}
