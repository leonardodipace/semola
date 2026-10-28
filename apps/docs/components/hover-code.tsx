import { highlight } from "fumadocs-core/highlight";
import type { ComponentProps, ReactNode } from "react";
import { HoverToken } from "@/components/hover-token";
import { codeThemes } from "@/lib/code-themes";
import {
  type CodeHover,
  type CodeSample,
  findHoverStart,
} from "@/lib/home-code";

type HoverSpanProps = ComponentProps<"span"> & {
  "data-hover"?: string;
};

const highlightOptions = { ...codeThemes, defaultColor: false } as const;

function Passthrough({ children }: ComponentProps<"pre">) {
  return <>{children}</>;
}

async function HoverTip({ hover }: { hover: CodeHover }) {
  let error: ReactNode = null;
  let type: ReactNode = null;
  let doc: ReactNode = null;

  if (hover.error) {
    error = (
      <p className="home-tip-error">
        {hover.error}{" "}
        <span className="home-tip-source">ts({hover.errorCode})</span>
      </p>
    );
  }

  if (hover.type) {
    const highlighted = await highlight(hover.type, {
      lang: "ts",
      ...highlightOptions,
      components: { pre: Passthrough },
    });

    type = <pre className="shiki home-tip-code">{highlighted}</pre>;
  }

  if (hover.doc) {
    doc = <p className="home-tip-doc">{hover.doc}</p>;
  }

  return (
    <>
      {error}
      {type}
      {doc}
    </>
  );
}

export async function HoverCode({
  sample,
  lang = "ts",
}: {
  sample: CodeSample;
  lang?: "ts" | "json";
}) {
  const { code, hovers } = sample;

  const decorations = hovers.map((hover, index) => {
    const start = findHoverStart(code, hover);

    return {
      start,
      end: start + hover.token.length,
      properties: { "data-hover": String(index) },
    };
  });

  const HoverSpan = (props: HoverSpanProps) => {
    const { "data-hover": hoverIndex, ...rest } = props;
    const hover = hovers[Number(hoverIndex)];

    if (!hover) return <span {...rest} />;

    let tone: "info" | "error" = "info";

    if (hover.error) tone = "error";

    return (
      <HoverToken
        tip={<HoverTip hover={hover} />}
        tone={tone}
        className={rest.className}
        style={rest.style}
      >
        {rest.children}
      </HoverToken>
    );
  };

  return highlight(code, {
    lang,
    ...highlightOptions,
    decorations,
    components: { pre: Passthrough, span: HoverSpan },
  });
}

export function CodePre({ children }: { children: ReactNode }) {
  return (
    <pre className="shiki home-shiki" data-line-numbers>
      {children}
    </pre>
  );
}
