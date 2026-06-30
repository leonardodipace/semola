import type { StandardSchemaV1 } from "@standard-schema/spec";
import { getDotPath } from "@standard-schema/utils";

export const formatIssuePath = (issue: StandardSchemaV1.Issue) => {
  const path = getDotPath(issue);

  return path ?? "unknown";
};

export const formatValidationIssues = (
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
) => {
  const arr = issues.map((issue) => {
    const path = formatIssuePath(issue);
    const message = issue.message ?? "validation failed";

    return `${path}: ${message}`;
  });

  return arr.join(", ");
};
