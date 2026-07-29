"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";

export function CodeSnippet({
  code,
  title,
}: {
  code: string;
  title?: string;
}) {
  return (
    <DynamicCodeBlock
      lang="ts"
      code={code}
      codeblock={{
        title,
        keepBackground: false,
        className: "my-0 shadow-none",
      }}
      options={{
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      }}
    />
  );
}
