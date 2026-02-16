import { err, ok } from "../../errors/index.js";

const sqlIdentifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const toSqlIdentifier = (value: string, label = "identifier") => {
  if (!sqlIdentifierRegex.test(value)) {
    return err("ValidationError", `Invalid SQL ${label}: ${value}`);
  }

  return ok(value);
};

export const toSqlIdentifierList = (values: string[], label = "identifier") => {
  const results: string[] = [];
  for (const value of values) {
    const [error, identifier] = toSqlIdentifier(value, label);
    if (error) {
      return err(error.type, error.message);
    }
    results.push(identifier);
  }
  return ok(results);
};
