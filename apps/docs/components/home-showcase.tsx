"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { homeModules } from "@/lib/home-modules";

const INTERVAL_MS = 6500;
const SLIDE_MS = 400;
const SLIDE_PX = 12;

const examples = homeModules.filter(
  (m) => m.id !== "cli" && m.id !== "prompts" && m.id !== "extra",
);

const codeThemes = {
  themes: {
    light: "github-light",
    dark: "github-dark",
  },
} as const;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);

    sync();
    media.addEventListener("change", sync);

    return () => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

export function HomeShowcase() {
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hovered, setHovered] = useState(false);
  const [inView, setInView] = useState(true);
  const [panelHeight, setPanelHeight] = useState<number>();
  const [indicator, setIndicator] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const reduceMotion = usePrefersReducedMotion();
  const topHalfRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const paused = hovered || !inView || reduceMotion;

  const goTo = (index: number) => {
    if (index === active) return;

    setPrevious(active);
    setDirection(index > active ? 1 : -1);
    setActive(index);
  };

  useEffect(() => {
    const topHalf = topHalfRef.current;

    if (!topHalf) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;

      setInView(entry.isIntersecting);
    });

    observer.observe(topHalf);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const tab = tabRefs.current[active];

    if (!nav) return;
    if (!tab) return;

    const sync = () => {
      const navRect = nav.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();

      setIndicator({
        x: tabRect.left - navRect.left + nav.scrollLeft,
        y: tabRect.top - navRect.top + nav.scrollTop,
        width: tabRect.width,
        height: tabRect.height,
      });
    };

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(nav);
    observer.observe(tab);

    return () => observer.disconnect();
  }, [active]);

  useLayoutEffect(() => {
    const slide = slideRefs.current[active];

    if (!slide) return;

    const sync = () => setPanelHeight(slide.offsetHeight);

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(slide);

    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    if (paused) return;

    const id = window.setInterval(() => {
      setActive((current) => {
        setPrevious(current);
        setDirection(1);

        return (current + 1) % examples.length;
      });
    }, INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [paused]);

  const transition = reduceMotion
    ? "opacity 150ms ease"
    : `opacity ${SLIDE_MS}ms var(--ease-out), transform ${SLIDE_MS}ms var(--ease-out)`;

  const enterY = direction > 0 ? SLIDE_PX : -SLIDE_PX;
  const exitY = -enterY;
  const current = examples[active];

  const slideStyle = (index: number) => {
    const isActive = index === active;

    return {
      opacity: isActive ? 1 : 0,
      transform: reduceMotion
        ? undefined
        : isActive
          ? "translateY(0)"
          : `translateY(${index === previous ? exitY : enterY}px)`,
      transition,
      pointerEvents: isActive ? ("auto" as const) : ("none" as const),
    };
  };

  return (
    <div className="home-fade-in w-full">
      <section
        aria-label="Code examples"
        className="relative overflow-hidden border-y border-fd-border bg-fd-background/80 backdrop-blur-md sm:rounded-2xl sm:border"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setHovered(false);
          }
        }}
      >
        <div
          ref={topHalfRef}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        />
        <div className="flex flex-col sm:flex-row">
          <div
            ref={navRef}
            className="relative flex max-h-64 gap-1 overflow-x-auto border-b border-fd-border px-3 py-3 sm:max-h-none sm:w-44 sm:shrink-0 sm:flex-col sm:gap-0.5 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:px-2 sm:py-3"
          >
            <div
              aria-hidden
              className="home-showcase-indicator pointer-events-none absolute top-0 left-0 rounded-md bg-wheat/10"
              style={{
                width: indicator.width || undefined,
                height: indicator.height || undefined,
                transform: `translate(${indicator.x}px, ${indicator.y}px)`,
                transition: reduceMotion
                  ? undefined
                  : `transform ${SLIDE_MS}ms var(--ease-out), width ${SLIDE_MS}ms var(--ease-out), height ${SLIDE_MS}ms var(--ease-out)`,
                opacity: indicator.width ? 1 : 0,
              }}
            >
              <span className="home-showcase-progress-track absolute top-1.5 bottom-1.5 left-1 w-0.5 overflow-hidden rounded-full bg-wheat/20 max-sm:top-auto max-sm:right-1.5 max-sm:bottom-0.5 max-sm:left-1.5 max-sm:h-0.5 max-sm:w-auto">
                <span
                  key={`${active}-${paused ? "paused" : "play"}`}
                  className={`home-showcase-progress-fill absolute inset-0 rounded-full bg-wheat ${
                    paused ? "is-paused" : ""
                  }`}
                />
              </span>
            </div>

            {examples.map((item, index) => (
              <button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                onClick={() => goTo(index)}
                className={`home-press home-ease relative z-10 shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-[color,transform] sm:w-full sm:pl-3.5 ${
                  index === active
                    ? "text-wheat"
                    : "home-tab-idle text-fd-muted-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative flex h-9 items-center overflow-hidden border-b border-fd-border px-4 font-mono text-xs text-fd-muted-foreground">
              {examples.map((item, index) => (
                <div
                  key={item.id}
                  className="absolute inset-y-0 left-4 right-4 flex items-center truncate"
                  style={slideStyle(index)}
                  aria-hidden={index !== active}
                >
                  <span className="text-wheat">{item.pkg}</span>
                  <span className="mx-2 text-fd-border">/</span>
                  <span>{item.file}</span>
                </div>
              ))}
            </div>

            <div
              className="home-showcase-code relative overflow-hidden text-left [&_.line]:px-0"
              style={{
                height: panelHeight,
                transition: reduceMotion
                  ? undefined
                  : `height ${SLIDE_MS}ms var(--ease-out)`,
              }}
            >
              {examples.map((item, index) => (
                <div
                  key={item.id}
                  ref={(element) => {
                    slideRefs.current[index] = element;
                  }}
                  className="absolute inset-x-0 top-0 overflow-hidden"
                  style={{
                    ...slideStyle(index),
                    zIndex: index === active ? 10 : index === previous ? 5 : 0,
                  }}
                  aria-hidden={index !== active}
                >
                  <DynamicCodeBlock
                    lang="ts"
                    code={item.code}
                    codeblock={{
                      allowCopy: false,
                      className:
                        "rounded-none border-0 bg-transparent shadow-none my-0 max-w-full",
                      keepBackground: false,
                      viewportProps: {
                        className: "!overflow-x-hidden",
                      },
                    }}
                    options={codeThemes}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="sr-only">
          Showing {current.label} example from {current.pkg}
        </p>
      </section>
    </div>
  );
}
