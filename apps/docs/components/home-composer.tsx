"use client";

import {
  CheckIcon,
  FileCodeIcon,
  FileJsonIcon,
  FolderIcon,
  PackageIcon,
  RotateCcwIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { readModuleIcon } from "@/lib/module-icons";
import { packageVersion } from "@/lib/shared";
import { useInView } from "@/lib/use-in-view";

const SERVER_FILE = "server.ts";
const TYPES_FILE = "types.ts";
const PACKAGE_FILE = "package.json";
const AUTOPLAY_IDS = ["schema", "queue", "cache"];
const AUTOPLAY_STEP_MS = 750;

const Grow = ({
  on,
  fresh,
  children,
}: {
  on: boolean;
  fresh: boolean;
  children: ReactNode;
}) => (
  <span data-on={on} data-fresh={fresh} inert={!on} className="home-grow">
    {children}
  </span>
);

type ComposerModule = {
  id: string;
  label: string;
  typeName: string;
  fileName: string;
  fileLines: number;
  hasRoute: boolean;
  hasStep: boolean;
  lines: number;
};

function ExplorerRow({
  icon: Icon,
  label,
  active = false,
  indent = false,
  fresh = false,
  onClick,
}: {
  icon: typeof FileCodeIcon;
  label: string;
  active?: boolean;
  indent?: boolean;
  fresh?: boolean;
  onClick?: () => void;
}) {
  let className =
    "home-ease flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-fd-muted-foreground transition-colors";

  if (active) {
    className =
      "home-ease flex w-full items-center gap-2 rounded-md bg-fd-background px-2 py-1 text-left text-fd-foreground shadow-[0_0_0_1px_var(--color-fd-border)] transition-colors";
  } else if (onClick) {
    className += " hover:text-fd-foreground";
  }

  if (fresh) {
    className += " home-dep-line";
  }

  const rowClassName = indent ? "pl-4" : undefined;

  if (!onClick) {
    return (
      <li className={rowClassName}>
        <span className={className}>
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
          {label}
        </span>
      </li>
    );
  }

  return (
    <li className={rowClassName}>
      <button type="button" onClick={onClick} className={className}>
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        {label}
      </button>
    </li>
  );
}

export function HomeComposer({
  baseImport,
  baseStart,
  baseHandler,
  baseEnd,
  baseLines,
  modules,
  importNodes,
  typeFileNodes,
  typeFileLines,
  fileNodes,
  routeNodes,
  stepNodes,
}: {
  baseImport: ReactNode;
  baseStart: ReactNode;
  baseHandler: ReactNode;
  baseEnd: ReactNode;
  baseLines: number;
  modules: ComposerModule[];
  importNodes: Record<string, ReactNode>;
  typeFileNodes: Record<string, ReactNode>;
  typeFileLines: Record<string, number>;
  fileNodes: Record<string, ReactNode>;
  routeNodes: Record<string, ReactNode>;
  stepNodes: Record<string, ReactNode>;
}) {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [lastAdded, setLastAdded] = useState("");
  const [activeFile, setActiveFile] = useState(SERVER_FILE);
  const [changes, setChanges] = useState(0);
  const touched = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { threshold: 0.35, once: true });

  useEffect(() => {
    if (!inView) return;

    const timers = AUTOPLAY_IDS.map((id, index) =>
      window.setTimeout(
        () => {
          if (touched.current) return;

          setEnabled((current) => [...current, id]);
          setLastAdded(id);
          setChanges((count) => count + 1);
        },
        AUTOPLAY_STEP_MS * (index + 1),
      ),
    );

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [inView]);

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

    const removed = modules.find((item) => item.id === id);
    if (removed?.fileName === activeFile) setActiveFile(SERVER_FILE);
  };

  const reset = () => {
    touched.current = true;
    setEnabled([]);
    setLastAdded("");
    setActiveFile(SERVER_FILE);
    setChanges((count) => count + 1);
  };

  const activeModules = modules.filter((item) => enabled.includes(item.id));
  const typeNames = activeModules
    .map((item) => item.typeName)
    .filter(Boolean)
    .sort();
  const typeFileKey = typeNames.join("|");
  const showTypes = typeNames.length > 0;

  useEffect(() => {
    const active = modules.filter((item) => enabled.includes(item.id));
    const open =
      activeFile === SERVER_FILE ||
      activeFile === PACKAGE_FILE ||
      (activeFile === TYPES_FILE && active.some((item) => item.typeName)) ||
      active.some((item) => item.fileName === activeFile);

    if (!open) setActiveFile(SERVER_FILE);
  }, [activeFile, enabled, modules]);

  const activeModuleFile = activeModules.find(
    (item) => item.fileName === activeFile,
  );
  const lastAddedFile = modules.find(
    (item) => item.id === lastAdded,
  )?.fileName;

  const serverLines = activeModules.reduce(
    (total, item) => total + item.lines,
    baseLines,
  );

  let lineCount = serverLines;
  if (activeFile === TYPES_FILE) {
    lineCount = typeFileLines[typeFileKey] ?? 0;
  } else if (activeFile === PACKAGE_FILE) {
    lineCount = 5;
  } else if (activeModuleFile) {
    lineCount = activeModuleFile.fileLines;
  }

  return (
    <div ref={rootRef} className="home-card overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-fd-border p-4 sm:p-5">
        {modules.map((item) => {
          const Icon = readModuleIcon(item.id);
          const on = enabled.includes(item.id);

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => chooseModule(item.id)}
              className="home-module-chip home-press home-ease inline-flex h-9 items-center gap-2 rounded-lg border border-fd-border bg-fd-background pr-2.5 pl-3 text-[13px] font-medium transition-[background-color,color,border-color,box-shadow,transform]"
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              {item.label}
              <span aria-hidden className="home-check">
                <CheckIcon className="size-2.5" strokeWidth={3} />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={reset}
          className="home-hover-fg home-ease ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs text-fd-muted-foreground transition-colors"
        >
          <RotateCcwIcon className="size-3.5" />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[14rem_minmax(0,1fr)_19rem]">
        <aside className="border-fd-border bg-fd-card/60 p-3 text-[13px] max-lg:border-b lg:border-r">
          <p className="home-label px-2 pt-1 pb-2">Explorer</p>
          <ul className="space-y-0.5">
            <ExplorerRow icon={FolderIcon} label="app" />
            <ExplorerRow
              icon={FileCodeIcon}
              label={SERVER_FILE}
              active={activeFile === SERVER_FILE}
              indent
              onClick={() => setActiveFile(SERVER_FILE)}
            />
            {showTypes ? (
              <ExplorerRow
                icon={FileCodeIcon}
                label={TYPES_FILE}
                active={activeFile === TYPES_FILE}
                fresh={Boolean(lastAdded && typeNames.length > 0)}
                indent
                onClick={() => setActiveFile(TYPES_FILE)}
              />
            ) : null}
            {activeModules.map((item) => {
              if (!item.fileName) return null;

              return (
                <ExplorerRow
                  key={item.id}
                  icon={FileCodeIcon}
                  label={item.fileName}
                  active={activeFile === item.fileName}
                  fresh={lastAddedFile === item.fileName}
                  indent
                  onClick={() => setActiveFile(item.fileName)}
                />
              );
            })}
            <ExplorerRow
              icon={FileJsonIcon}
              label={PACKAGE_FILE}
              active={activeFile === PACKAGE_FILE}
              indent
              onClick={() => setActiveFile(PACKAGE_FILE)}
            />
          </ul>

          <p className="home-label mt-6 px-2 pb-2">Dependencies</p>
          <div className="flex items-center gap-2 rounded-md px-2 py-1">
            <PackageIcon
              className="size-3.5 shrink-0 text-wheat"
              strokeWidth={1.75}
            />
            <span>semola</span>
            <span className="ml-auto font-mono text-[11px] text-fd-muted-foreground">
              {packageVersion}
            </span>
          </div>
        </aside>

        <div className="border-fd-border min-w-0 lg:border-r">
          <div className="flex h-10 items-center gap-3 border-b border-fd-border bg-fd-background/50 px-4 font-mono text-xs whitespace-nowrap">
            <span className="rounded-md bg-fd-background px-2.5 py-1 shadow-[0_0_0_1px_var(--color-fd-border)]">
              {activeFile}
            </span>
            <span className="ml-auto text-fd-muted-foreground tabular-nums">
              {lineCount} lines
              {activeFile === SERVER_FILE ? (
                <span className="max-sm:hidden">
                  {" "}
                  - {activeModules.length + 1} imports
                </span>
              ) : null}
            </span>
          </div>
          <div className="home-composer-viewport relative h-[26rem] overflow-auto py-3 sm:h-[30rem]">
            {activeFile === SERVER_FILE ? (
              <pre
                className="shiki home-shiki home-composer-code"
                data-line-numbers
              >
                {baseImport}
                {modules.map((item) => (
                  <Grow
                    key={`${item.id}-import`}
                    on={enabled.includes(item.id)}
                    fresh={lastAdded === item.id}
                  >
                    {importNodes[item.id]}
                  </Grow>
                ))}
                {baseStart}
                {modules.map((item) => {
                  if (!item.hasRoute) return null;

                  return (
                    <Grow
                      key={`${item.id}-route`}
                      on={enabled.includes(item.id)}
                      fresh={lastAdded === item.id}
                    >
                      {routeNodes[item.id]}
                    </Grow>
                  );
                })}
                {baseHandler}
                {[...modules]
                  .filter((item) => item.hasStep)
                  .sort((left, right) => {
                    if (left.id === "policy") return -1;
                    if (right.id === "policy") return 1;
                    return 0;
                  })
                  .map((item) => (
                    <Grow
                      key={`${item.id}-step`}
                      on={enabled.includes(item.id)}
                      fresh={lastAdded === item.id}
                    >
                      {stepNodes[item.id]}
                    </Grow>
                  ))}
                {baseEnd}
              </pre>
            ) : null}

            {activeFile === TYPES_FILE && showTypes ? (
              <pre
                className="shiki home-shiki home-composer-code"
                data-line-numbers
              >
                {typeFileNodes[typeFileKey]}
              </pre>
            ) : null}

            {activeModuleFile ? (
              <pre
                className="shiki home-shiki home-composer-code"
                data-line-numbers
              >
                {fileNodes[activeModuleFile.id]}
              </pre>
            ) : null}

            {activeFile === PACKAGE_FILE ? (
              <pre className="home-composer-code px-4 font-mono text-[13px] leading-6">
                <span className="line">{"{"}</span>
                <span className="line pl-4">
                  <span className="text-wheat">"dependencies"</span>: {"{"}
                </span>
                <span
                  key={changes}
                  className="home-dep-line line -mx-2 block rounded-md pr-2 pl-[calc(2rem+0.5rem)]"
                >
                  <span className="text-wheat">"semola"</span>:{" "}
                  <span className="text-crust">"^{packageVersion}"</span>
                </span>
                <span className="line pl-4">{"}"}</span>
                <span className="line">{"}"}</span>
              </pre>
            ) : null}
          </div>
        </div>

        <aside className="flex flex-col border-t border-fd-border p-5 sm:p-6 lg:border-t-0">
          <div className="relative mt-auto">
            <p className="home-label">Extra packages pulled in</p>
            <p className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-5xl font-semibold tracking-tight">
                0
              </span>
              <span className="text-sm text-fd-muted-foreground">
                still zero after every toggle
              </span>
            </p>
            <span
              key={changes}
              aria-hidden
              data-show={changes > 0}
              className="home-float pointer-events-none absolute top-6 left-8 rounded-md bg-wheat/15 px-2 py-0.5 font-mono text-xs text-wheat"
            >
              +0
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
