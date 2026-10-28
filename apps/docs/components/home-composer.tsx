"use client";

import { RotateCcwIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { composerBase, composerModules } from "@/lib/home-code";
import { readModuleIcon } from "@/lib/module-icons";

const AUTOPLAY_IDS = ["queue", "cron", "cache"];
const AUTOPLAY_STEP_MS = 750;

const countLines = (code: string) => code.split("\n").length;

const baseLineCount =
  countLines(composerBase.import) +
  countLines(composerBase.start) +
  countLines(composerBase.end);

function Grow({
  on,
  fresh,
  children,
}: {
  on: boolean;
  fresh: boolean;
  children: ReactNode;
}) {
  return (
    <span data-on={on} data-fresh={fresh} className="home-grow">
      {children}
    </span>
  );
}

export function HomeComposer({
  baseImport,
  baseStart,
  baseEnd,
  moduleImports,
  moduleCode,
  version,
}: {
  baseImport: ReactNode;
  baseStart: ReactNode;
  baseEnd: ReactNode;
  moduleImports: Record<string, ReactNode>;
  moduleCode: Record<string, ReactNode>;
  version: string;
}) {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [lastAdded, setLastAdded] = useState("");
  const [changes, setChanges] = useState(0);
  const touched = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rootRef.current;

    if (!element) return;

    const timers: number[] = [];

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        observer.disconnect();

        AUTOPLAY_IDS.forEach((id, index) => {
          const timer = window.setTimeout(
            () => {
              if (touched.current) return;

              setEnabled((current) => [...current, id]);
              setLastAdded(id);
              setChanges((count) => count + 1);
            },
            AUTOPLAY_STEP_MS * (index + 1),
          );

          timers.push(timer);
        });
      },
      { threshold: 0.35 },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();

      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!lastAdded) return;

    const viewport = viewportRef.current;
    const block = viewport?.querySelector(`[data-block="${lastAdded}"]`);

    if (!viewport) return;
    if (!(block instanceof HTMLElement)) return;

    const timer = window.setTimeout(() => {
      viewport.scrollTo({
        top: block.offsetTop - viewport.clientHeight / 3,
        behavior: "smooth",
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [lastAdded]);

  const chooseModule = (id: string) => {
    touched.current = true;

    setChanges((count) => count + 1);

    if (!enabled.includes(id)) {
      setEnabled([...enabled, id]);
      setLastAdded(id);
      return;
    }

    setEnabled(enabled.filter((item) => item !== id));
    setLastAdded("");
  };

  const reset = () => {
    touched.current = true;
    setEnabled([]);
    setLastAdded("");
    setChanges((count) => count + 1);
  };

  const activeModules = composerModules.filter((module) =>
    enabled.includes(module.id),
  );
  const lineCount = activeModules.reduce(
    (total, module) =>
      total + countLines(module.import) + countLines(module.code),
    baseLineCount,
  );

  return (
    <div ref={rootRef} className="home-card overflow-hidden rounded-3xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border p-4 sm:p-5">
        {composerModules.map((module) => {
          const Icon = readModuleIcon(module.id);
          const on = enabled.includes(module.id);

          return (
            <button
              key={module.id}
              type="button"
              aria-pressed={on}
              onClick={() => chooseModule(module.id)}
              className="home-module-chip home-press home-ease inline-flex h-9 items-center gap-2 rounded-full pr-4 pl-3 text-sm font-medium transition-[background-color,color,box-shadow,transform]"
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {module.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={reset}
          className="home-hover-fg home-ease ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs text-fd-muted-foreground transition-colors"
        >
          <RotateCcwIcon className="size-3.5" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="border-fd-border lg:border-r">
          <div className="flex h-10 items-center gap-3 border-b border-fd-border bg-fd-background/50 px-4 font-mono text-xs whitespace-nowrap">
            <span>server.ts</span>
            <span className="text-fd-muted-foreground tabular-nums">
              {lineCount} lines
            </span>
            <span className="ml-auto text-fd-muted-foreground">
              {activeModules.length + 1} imports
              <span className="max-sm:hidden"> from semola</span>
            </span>
          </div>
          <div
            ref={viewportRef}
            className="home-composer-viewport relative h-[26rem] overflow-auto py-3 sm:h-[30rem]"
          >
            <pre
              className="shiki home-shiki home-composer-code"
              data-line-numbers
            >
              {baseImport}
              {composerModules.map((module) => (
                <Grow
                  key={module.id}
                  on={enabled.includes(module.id)}
                  fresh={lastAdded === module.id}
                >
                  {moduleImports[module.id]}
                </Grow>
              ))}
              {baseStart}
              {composerModules.map((module) => (
                <span key={module.id} data-block={module.id}>
                  <Grow
                    on={enabled.includes(module.id)}
                    fresh={lastAdded === module.id}
                  >
                    {moduleCode[module.id]}
                  </Grow>
                </span>
              ))}
              {baseEnd}
            </pre>
          </div>
        </div>

        <aside className="flex flex-col gap-6 border-t border-fd-border p-5 sm:p-6 lg:border-t-0">
          <div className="font-mono text-[13px] leading-6">
            <p className="home-label mb-3">package.json</p>
            <p>{"{"}</p>
            <p className="pl-4">
              <span className="text-wheat">"dependencies"</span>: {"{"}
            </p>
            <p
              key={changes}
              className="home-dep-line -mx-2 rounded-md pr-2 pl-[calc(2rem+0.5rem)]"
            >
              <span className="text-wheat">"semola"</span>:{" "}
              <span className="text-crust">"^{version}"</span>
            </p>
            <p className="pl-4">{"}"}</p>
            <p>{"}"}</p>
          </div>

          <div className="relative mt-auto">
            <p className="home-label">Dependencies added</p>
            <p className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-5xl font-semibold tracking-tight">
                0
              </span>
              <span className="text-sm text-fd-muted-foreground">
                no matter how many you pick
              </span>
            </p>
            <span
              key={changes}
              aria-hidden
              data-show={changes > 0}
              className="home-float pointer-events-none absolute top-6 left-8 rounded-full bg-wheat/15 px-2 py-0.5 font-mono text-xs text-wheat"
            >
              +0
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
