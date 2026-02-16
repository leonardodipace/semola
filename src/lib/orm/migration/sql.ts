const sqlIdentifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const toSqlIdentifier = (value: string, label = "identifier") => {
  if (!sqlIdentifierRegex.test(value)) {
    throw new Error(`Invalid SQL ${label}: ${value}`);
  }

  return value;
};

export const toSqlIdentifierList = (values: string[], label = "identifier") => {
  return values.map((value) => toSqlIdentifier(value, label));
};
