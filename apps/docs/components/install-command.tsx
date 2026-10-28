"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef, useState } from "react";

const COMMAND = "bun add semola";

export function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number>(undefined);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
    } catch {
      return;
    }

    setCopied(true);

    if (resetTimer.current !== undefined) {
      window.clearTimeout(resetTimer.current);
    }

    resetTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      className="home-press home-secondary-btn home-ease inline-flex h-11 items-center gap-3 rounded-full px-5 font-mono text-[13px] transition-[background-color,transform]"
      aria-label="Copy install command"
    >
      <span className="select-none text-fd-muted-foreground">$</span>
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
