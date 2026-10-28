"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useInView } from "@/lib/use-in-view";

const ADVANCE_MS = 7000;

export type ContractTab = {
  id: string;
  file: string;
  title: string;
  body: ReactNode;
  code: ReactNode;
};

export function HomeContractTabs({ tabs }: { tabs: ContractTab[] }) {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const inView = useInView(rootRef, { threshold: 0.3 });

  useEffect(() => {
    if (!autoplay) return;
    if (!inView) return;

    const timer = window.setTimeout(() => {
      setActive((active + 1) % tabs.length);
    }, ADVANCE_MS);

    return () => window.clearTimeout(timer);
  }, [autoplay, inView, active, tabs.length]);

  const choose = (index: number) => {
    setAutoplay(false);
    setActive(index);
  };

  const onTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let step = 0;

    if (event.key === "ArrowRight") step = 1;
    if (event.key === "ArrowLeft") step = -1;
    if (step === 0) return;

    event.preventDefault();

    const next = (active + step + tabs.length) % tabs.length;

    choose(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      data-autoplay={autoplay && inView}
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10"
    >
      <ol className="flex flex-col gap-2">
        {tabs.map((tab, index) => (
          <li key={tab.id}>
            <button
              type="button"
              aria-pressed={index === active}
              onClick={() => choose(index)}
              className="home-contract-item home-ease relative w-full overflow-hidden rounded-2xl p-5 text-left transition-[background-color,box-shadow] sm:p-6"
            >
              <span className="home-label flex items-center gap-2">
                <span className="text-wheat">0{index + 1}</span>
                {tab.file}
              </span>
              <span className="mt-2 block text-lg font-semibold tracking-tight">
                {tab.title}
              </span>
              <span className="home-contract-body mt-1.5 block text-[15px] leading-relaxed text-fd-muted-foreground">
                {tab.body}
              </span>
              <span
                aria-hidden
                key={`${active}-${index === active}`}
                className="home-contract-progress absolute inset-x-0 bottom-0 h-0.5 origin-left bg-wheat"
                style={{ animationDuration: `${ADVANCE_MS}ms` }}
              />
            </button>
          </li>
        ))}
      </ol>

      <figure
        aria-label={tabs[active]?.file}
        className="home-window overflow-hidden rounded-2xl lg:sticky lg:top-24 lg:self-start"
      >
        <div
          role="tablist"
          aria-label="Contract files"
          onKeyDown={onTabListKeyDown}
          className="home-window-bar flex h-11 items-center gap-1 overflow-x-auto px-3 font-mono text-xs"
        >
          <div aria-hidden className="home-traffic mr-3 pl-1">
            <span />
            <span />
            <span />
          </div>
          {tabs.map((tab, index) => {
            const selected = index === active;
            let tabIndex = -1;

            if (selected) tabIndex = 0;

            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`contract-panel-${tab.id}`}
                tabIndex={tabIndex}
                data-active={selected}
                onClick={() => choose(index)}
                className="home-file-tab home-ease shrink-0 rounded-md px-2.5 py-1 transition-[background-color,color]"
              >
                {tab.file}
              </button>
            );
          })}
        </div>
        <div className="grid h-[28rem] overflow-hidden sm:h-[32rem]">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              id={`contract-panel-${tab.id}`}
              role="tabpanel"
              data-active={index === active}
              inert={index !== active}
              className="home-fade-slide overflow-auto py-3 [grid-area:1/1]"
            >
              {tab.code}
            </div>
          ))}
        </div>
      </figure>
    </div>
  );
}
