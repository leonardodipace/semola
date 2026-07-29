"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

const COMMAND = "bun add semola";

export function InstallCommand() {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="group inline-flex items-center gap-3 rounded-full border border-fd-border bg-fd-secondary/40 px-4 py-2 font-mono text-sm transition-colors hover:bg-fd-accent"
      aria-label="Copy install command"
    >
      <span className="text-wheat">$</span>
      <code>{COMMAND}</code>
      <span className="text-fd-muted-foreground group-hover:text-fd-foreground">
        {copied ? (
          <CheckIcon className="size-3.5 text-wheat" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </span>
    </button>
  );
}
