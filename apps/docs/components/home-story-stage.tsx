"use client";

import { ArrowRightIcon, CircleXIcon } from "lucide-react";
import Link from "next/link";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { readModuleIcon } from "@/lib/module-icons";

export type ModuleStory = {
  pkg: string;
  label: string;
  href: string;
  title: string;
  body: string;
  file: string;
  breakLabel: string;
  errorMessage: string;
  errorLocation: string;
  code: ReactNode;
  brokenCode: ReactNode;
};

const readSlug = (pkg: string) => pkg.replace("semola/", "");

function StageTabs({
  stories,
  active,
  panelId,
  onSelect,
}: {
  stories: ModuleStory[];
  active: number;
  panelId: string;
  onSelect: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<CSSProperties>({ opacity: 0 });

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabRefs.current[active];

      if (!tab) return;

      setIndicator({
        width: tab.offsetWidth,
        transform: `translateX(${tab.offsetLeft}px)`,
      });
    };

    measure();

    const observer = new ResizeObserver(measure);

    if (listRef.current) observer.observe(listRef.current);

    return () => observer.disconnect();
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let step = 0;

    if (event.key === "ArrowRight") step = 1;
    if (event.key === "ArrowLeft") step = -1;
    if (step === 0) return;

    event.preventDefault();

    const next = (active + step + stories.length) % stories.length;

    onSelect(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="home-tabs-scroll -mx-1 max-w-full overflow-x-auto px-1 py-1">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Semola modules"
        onKeyDown={onKeyDown}
        className="home-tabs relative inline-flex items-center gap-0.5 rounded-full p-1"
      >
        <span
          aria-hidden
          className="home-tab-indicator absolute top-1 bottom-1 left-0 rounded-full"
          style={indicator}
        />
        {stories.map((story, index) => {
          const Icon = readModuleIcon(readSlug(story.pkg));
          const selected = index === active;
          let tabIndex = -1;

          if (selected) tabIndex = 0;

          return (
            <button
              key={story.pkg}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={tabIndex}
              onClick={() => onSelect(index)}
              className="home-tab relative inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-medium"
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {story.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BreakSwitch({
  story,
  broken,
  onToggle,
}: {
  story: ModuleStory;
  broken: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={broken}
      onClick={onToggle}
      className="home-break home-press home-ease flex w-full items-center gap-4 rounded-2xl p-4 text-left transition-[background-color,border-color,transform]"
    >
      <span aria-hidden className="home-switch">
        <span className="home-switch-thumb" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">Break it</span>
        <span
          key={story.pkg}
          className="home-ticker-swap block truncate text-[13px] text-fd-muted-foreground"
        >
          {story.breakLabel}
        </span>
      </span>
    </button>
  );
}

function CodeStatus({ broken }: { broken: boolean }) {
  if (broken) {
    return (
      <span className="home-code-status flex items-center gap-2" data-broken>
        <span className="size-1.5 rounded-full bg-current" />1 problem
      </span>
    );
  }

  return (
    <span className="home-code-status flex items-center gap-2">
      <span className="size-1.5 rounded-full bg-current" />
      Types check
    </span>
  );
}

export function HomeStoryStage({ stories }: { stories: ModuleStory[] }) {
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const panelId = useId();
  const story = stories[active];

  if (!story) return null;

  const select = (index: number) => {
    if (index === active) return;

    let next: "forward" | "back" = "forward";

    if (index < active) next = "back";

    setDirection(next);
    setActive(index);
    setBroken(false);
  };

  return (
    <div
      data-direction={direction}
      className="home-stage rounded-[28px] p-1.5 sm:p-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-1 pb-2.5 sm:px-3 sm:pt-2 sm:pb-3">
        <StageTabs
          stories={stories}
          active={active}
          panelId={panelId}
          onSelect={select}
        />
        <p className="home-label pr-2 max-md:hidden">
          {active + 1} of {stories.length}
        </p>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-label={story.label}
        className="home-stage-inner grid overflow-hidden rounded-[22px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      >
        <div className="home-stage-copy flex flex-col gap-10 p-7 sm:p-10">
          <div className="grid">
            {stories.map((item, index) => (
              <div
                key={item.pkg}
                data-active={index === active}
                inert={index !== active}
                className="home-stage-slide home-stage-copy-slide [grid-area:1/1]"
              >
                <p className="home-label text-wheat">{item.pkg}</p>
                <h3 className="home-title mt-5 text-3xl font-semibold text-balance sm:text-[2.6rem]">
                  {item.title}
                </h3>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-fd-muted-foreground sm:text-base">
                  {item.body}
                </p>
                <Link
                  href={item.href}
                  className="home-press home-ease mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-wheat transition-transform"
                >
                  {item.label} docs
                  <ArrowRightIcon className="home-arrow size-3.5" />
                </Link>
              </div>
            ))}
          </div>

          <div className="mt-auto">
            <BreakSwitch
              story={story}
              broken={broken}
              onToggle={() => setBroken(!broken)}
            />
          </div>
        </div>

        <figure
          aria-label={story.file}
          data-broken={broken}
          className="home-stage-code flex min-w-0 flex-col"
        >
          <figcaption className="flex h-12 items-center justify-between gap-4 border-b border-fd-border px-5 font-mono text-xs">
            <span
              key={story.pkg}
              className="home-ticker-swap text-fd-foreground"
            >
              {story.file}
            </span>
            <CodeStatus broken={broken} />
          </figcaption>

          <div className="grid flex-1">
            {stories.map((item, index) => {
              let code = item.code;

              if (index === active) {
                if (broken) code = item.brokenCode;
              }

              return (
                <div
                  key={item.pkg}
                  data-active={index === active}
                  inert={index !== active}
                  className="home-stage-slide home-stage-code-slide home-scroll-x overflow-x-auto py-5 [grid-area:1/1]"
                >
                  {code}
                </div>
              );
            })}
          </div>

          <div data-on={broken} inert={!broken} className="home-grow">
            <div>
              <div className="home-diagnostic flex gap-3 px-5 py-4 text-[13px] leading-5">
                <CircleXIcon className="mt-0.5 size-4 shrink-0 text-red-500" />
                <div className="min-w-0">
                  <p className="text-fd-foreground">{story.errorMessage}</p>
                  <p className="mt-1 font-mono text-[11px] whitespace-pre text-fd-muted-foreground">
                    {story.errorLocation}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </figure>
      </div>
    </div>
  );
}
