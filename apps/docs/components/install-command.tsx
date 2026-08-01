"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

const COMMAND = "bun add semola";

export function InstallCommand({
  variant = "pill",
}: {
  variant?: "pill" | "solid";
}) {
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
      className={
        variant === "solid"
          ? "home-press home-ease inline-flex items-center gap-3 rounded-lg border border-fd-border bg-fd-background px-5 py-3 font-mono text-sm transition-[background-color,transform]"
          : "home-press home-hover-bg home-ease inline-flex items-center gap-3 rounded-full border border-fd-border bg-fd-secondary/50 px-4 py-2 font-mono text-sm transition-[background-color,transform]"
      }
      aria-label="Copy install command"
    >
      <span className="text-wheat">$</span>
      <code>{COMMAND}</code>
      <span
        className={`relative size-3.5 transition-[color,filter,opacity] duration-150 ease-[var(--ease-out)] ${
          copied ? "text-wheat" : "text-fd-muted-foreground"
        }`}
      >
        <CheckIcon
          className={`absolute inset-0 size-3.5 transition-[opacity,filter] duration-150 ease-[var(--ease-out)] ${
            copied ? "opacity-100 blur-0" : "opacity-0 blur-[2px]"
          }`}
        />
        <CopyIcon
          className={`absolute inset-0 size-3.5 transition-[opacity,filter] duration-150 ease-[var(--ease-out)] ${
            copied ? "opacity-0 blur-[2px]" : "opacity-100 blur-0"
          }`}
        />
      </span>
    </button>
  );
}
