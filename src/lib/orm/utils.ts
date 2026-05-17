export const quoteIdentifier = (identifier: string) => {
  identifier = identifier.replaceAll('"', '""');

  return `"${identifier}"`;
};
