"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { codeThemes } from "@/lib/code-themes";

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
      options={codeThemes}
    />
  );
}
