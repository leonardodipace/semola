import type { Issue } from "./types.js";

export class SchemaError extends Error {
  public readonly issues: ReadonlyArray<Issue>;

  public constructor(issues: ReadonlyArray<Issue>) {
    super(formatIssues(issues));
    this.name = "SchemaError";
    this.issues = issues;
  }
}

export class UnsupportedJsonSchemaTargetError extends Error {
  public constructor(target: string) {
    super(`Unsupported JSON Schema target: ${target}`);
    this.name = "UnsupportedJsonSchemaTargetError";
  }
}

const formatIssuePath = (issue: Issue) => {
  if (!issue.path) return;
  if (issue.path.length === 0) return;

  return issue.path
    .map((segment) => {
      if (typeof segment === "object") {
        return String(segment.key);
      }

      return String(segment);
    })
    .join(".");
};

export const formatIssues = (issues: ReadonlyArray<Issue>) => {
  return issues
    .map((issue) => {
      const path = formatIssuePath(issue);

      if (!path) {
        return issue.message;
      }

      return `${path}: ${issue.message}`;
    })
    .join(", ");
};
