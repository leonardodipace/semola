"use client";

import {
  CircleCheckIcon,
  CircleXIcon,
  MousePointer2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

export function HomeHeroEditor({
  code,
  brokenCode,
  sidebar,
  errorMessage,
  errorLocation,
  version,
}: {
  code: ReactNode;
  brokenCode: ReactNode;
  sidebar: ReactNode;
  errorMessage: string;
  errorLocation: string;
  version: string;
}) {
  const [broken, setBroken] = useState(false);

  let visibleCode = code;
  let errorCount = 0;

  if (broken) {
    visibleCode = brokenCode;
    errorCount = 1;
  }

  return (
    <div className="relative">
      <figure
        aria-label="server.ts in an editor, with type information on hover"
        data-broken={broken}
        className="home-window home-editor overflow-hidden rounded-2xl"
      >
        <div className="home-window-bar flex h-11 items-center gap-4 px-4">
          <div aria-hidden className="home-traffic">
            <span />
            <span />
            <span />
          </div>
          <span className="flex items-center gap-2 rounded-md bg-fd-background px-2.5 py-1 font-mono text-xs shadow-[0_0_0_1px_var(--color-fd-border)]">
            server.ts
            <span
              aria-hidden
              data-broken={broken}
              className="home-editor-dot size-1.5 rounded-full"
            />
          </span>
          <span className="home-label ml-auto flex items-center gap-1.5 max-sm:hidden">
            <MousePointer2Icon className="size-3.5 text-wheat" />
            Hover the underlined code
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)]">
          {sidebar}
          <div className="overflow-x-auto py-3 lg:pb-24">{visibleCode}</div>
        </div>

        <div className="home-statusbar flex h-7 items-center gap-4 px-4 font-mono text-[11px]">
          <span className="flex items-center gap-1.5" data-tone="error">
            <CircleXIcon className="size-3" />
            {errorCount}
          </span>
          <span className="flex items-center gap-1.5">
            <TriangleAlertIcon className="size-3" />0
          </span>
          <span className="max-sm:hidden">TypeScript</span>
          <span>semola {version}</span>
        </div>
      </figure>

      <ProblemsPanel
        broken={broken}
        errorMessage={errorMessage}
        errorLocation={errorLocation}
        onToggle={() => setBroken(!broken)}
      />
    </div>
  );
}

function ProblemsPanel({
  broken,
  errorMessage,
  errorLocation,
  onToggle,
}: {
  broken: boolean;
  errorMessage: string;
  errorLocation: string;
  onToggle: () => void;
}) {
  let body = (
    <>
      <p className="flex items-center gap-2 text-(--terminal-fg)">
        <CircleCheckIcon className="size-4 text-emerald-400" />
        No problems in server.ts
      </p>
      <p className="mt-1.5 text-(--terminal-dim)">
        Responses are checked against the schema too. Go on, break it.
      </p>
    </>
  );
  let buttonLabel = "Misspell a field";
  let ButtonIcon = WandSparklesIcon;

  if (broken) {
    body = (
      <>
        <p className="flex gap-2 text-(--terminal-fg)">
          <CircleXIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
          <span className="line-clamp-3">{errorMessage}</span>
        </p>
        <p className="mt-1.5 pl-6 font-mono text-[11px] whitespace-pre text-(--terminal-dim)">
          {errorLocation}
        </p>
      </>
    );
    buttonLabel = "Fix it";
    ButtonIcon = WrenchIcon;
  }

  return (
    <div
      aria-live="polite"
      className="home-terminal relative z-10 mx-auto -mt-16 w-[calc(100%-2rem)] overflow-hidden rounded-xl text-[12.5px] leading-5 sm:w-[25rem] lg:absolute lg:right-8 lg:-bottom-10 lg:mt-0"
    >
      <div className="flex h-9 items-center gap-3 border-b border-white/10 px-3.5 font-mono text-[11px] tracking-wide text-(--terminal-dim)">
        PROBLEMS
        <span
          data-broken={broken}
          className="home-problem-count rounded-full px-1.5 text-[10px] leading-4"
        >
          {Number(broken)}
        </span>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <div className="min-h-[4.25rem]">{body}</div>
        <button
          type="button"
          onClick={onToggle}
          className="home-press home-ease inline-flex h-8 items-center gap-2 self-start rounded-full bg-white/10 px-3.5 text-[12px] font-medium text-(--terminal-fg) transition-[background-color,transform] hover:bg-white/15"
        >
          <ButtonIcon className="size-3.5 text-wheat" />
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
