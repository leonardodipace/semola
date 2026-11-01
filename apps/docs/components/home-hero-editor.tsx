"use client";

import {
  CircleCheckIcon,
  CircleXIcon,
  MousePointer2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { packageVersion } from "@/lib/shared";

export type HeroScenario = "clean" | "typo" | "status";

const scenarios = [
  {
    id: "clean" as const,
    label: "All good",
    ok: "No problems in server.ts",
    hint: "Responses are checked against the schema too. Try breaking it.",
  },
  {
    id: "typo" as const,
    label: "Typo a field",
    ok: "",
    hint: "",
  },
  {
    id: "status" as const,
    label: "Wrong status",
    ok: "",
    hint: "",
  },
];

export function HomeHeroEditor({
  code,
  typoCode,
  statusCode,
  sidebar,
  typoError,
  statusError,
}: {
  code: ReactNode;
  typoCode: ReactNode;
  statusCode: ReactNode;
  sidebar: ReactNode;
  typoError: { message: string; location: string };
  statusError: { message: string; location: string };
}) {
  const [scenario, setScenario] = useState<HeroScenario>("clean");

  let visibleCode = code;
  let errorCount = 0;
  let errorMessage = "";
  let errorLocation = "";

  if (scenario === "typo") {
    visibleCode = typoCode;
    errorCount = 1;
    errorMessage = typoError.message;
    errorLocation = typoError.location;
  }

  if (scenario === "status") {
    visibleCode = statusCode;
    errorCount = 1;
    errorMessage = statusError.message;
    errorLocation = statusError.location;
  }

  return (
    <div className="relative">
      <figure
        aria-label="Interactive Semola server.ts editor"
        data-broken={scenario !== "clean"}
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
              data-broken={scenario !== "clean"}
              className="home-editor-dot size-1.5 rounded-full"
            />
          </span>
          <span className="home-label ml-auto flex items-center gap-1.5 max-sm:hidden">
            <MousePointer2Icon className="size-3.5 text-wheat" />
            Hover underlined code
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)]">
          {sidebar}
          <div className="overflow-x-auto py-3 lg:pb-28">{visibleCode}</div>
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
          <span>semola {packageVersion}</span>
        </div>
      </figure>

      <ProblemsPanel
        scenario={scenario}
        errorMessage={errorMessage}
        errorLocation={errorLocation}
        onSelect={setScenario}
      />
    </div>
  );
}

function ProblemsPanel({
  scenario,
  errorMessage,
  errorLocation,
  onSelect,
}: {
  scenario: HeroScenario;
  errorMessage: string;
  errorLocation: string;
  onSelect: (scenario: HeroScenario) => void;
}) {
  const active = scenarios.find((item) => item.id === scenario) ?? scenarios[0];
  const broken = scenario !== "clean";

  let body = (
    <>
      <p className="flex items-center gap-2 text-(--terminal-fg)">
        <CircleCheckIcon className="size-4 text-emerald-400" />
        {active?.ok}
      </p>
      <p className="mt-1.5 text-(--terminal-dim)">{active?.hint}</p>
    </>
  );

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
  }

  return (
    <div
      aria-live="polite"
      className="home-terminal relative z-10 mx-auto -mt-16 w-[calc(100%-2rem)] overflow-hidden rounded-xl text-[12.5px] leading-5 sm:w-[26rem] lg:absolute lg:right-8 lg:-bottom-10 lg:mt-0"
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
        <div
          role="group"
          aria-label="Break the example"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-white/5 p-1"
        >
          {scenarios.map((item) => {
            let className =
              "home-press home-ease inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-medium text-(--terminal-dim) transition-[background-color,color,transform]";

            if (scenario === item.id) {
              className =
                "home-press home-ease inline-flex h-8 items-center rounded-lg bg-white/10 px-3 text-[12px] font-medium text-(--terminal-fg) transition-[background-color,color,transform]";
            }

            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={scenario === item.id}
                onClick={() => onSelect(item.id)}
                className={className}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
