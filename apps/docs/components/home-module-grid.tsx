"use client";

import { ArrowUpRightIcon, CornerDownLeftIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type PointerEvent, useId, useState } from "react";
import { readModuleIcon } from "@/lib/module-icons";

export type GridModule = {
  slug: string;
  pkg: string;
  href: string;
  blurb: string;
  group: string;
};

const PLACEHOLDER = "queue";

const matchesQuery = (module: GridModule, needle: string) => {
  if (module.slug.includes(needle)) return true;
  if (module.blurb.toLowerCase().includes(needle)) return true;

  return module.group.toLowerCase().includes(needle);
};

const rankModules = (modules: GridModule[], needle: string) => {
  if (!needle) return [];

  const prefixed = modules.filter((module) => module.slug.startsWith(needle));
  const others = modules.filter((module) => {
    if (module.slug.startsWith(needle)) return false;

    return matchesQuery(module, needle);
  });

  return [...prefixed, ...others];
};

const readGhostText = (module: GridModule | undefined, needle: string) => {
  if (!module) return "";
  if (!module.slug.startsWith(needle)) return "";

  return module.slug.slice(needle.length);
};

const trackSpotlight = (event: PointerEvent<HTMLAnchorElement>) => {
  const tile = event.currentTarget;
  const rect = tile.getBoundingClientRect();

  tile.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
  tile.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
};

function SlugLabel({ slug, needle }: { slug: string; needle: string }) {
  const start = slug.indexOf(needle);

  if (!needle) return <>semola/{slug}</>;
  if (start === -1) return <>semola/{slug}</>;

  return (
    <>
      semola/{slug.slice(0, start)}
      <mark className="home-grid-match">
        {slug.slice(start, start + needle.length)}
      </mark>
      {slug.slice(start + needle.length)}
    </>
  );
}

function FilterSummary({
  needle,
  matchCount,
  total,
}: {
  needle: string;
  matchCount: number;
  total: number;
}) {
  if (!needle) {
    return <>{total} modules</>;
  }

  if (matchCount === 0) {
    return <>No module matches. Try "queue" or "redis".</>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      {matchCount} of {total}
      <kbd className="home-kbd inline-flex items-center">
        <CornerDownLeftIcon className="size-3" />
      </kbd>
      to open
    </span>
  );
}

export function HomeModuleGrid({ modules }: { modules: GridModule[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const summaryId = useId();

  const needle = query.trim().toLowerCase();
  const matches = rankModules(modules, needle);
  const current = matches[Math.min(selected, matches.length - 1)];
  const ghost = readGhostText(current, needle);
  let inputWidth = PLACEHOLDER.length;

  if (query) inputWidth = query.length;

  const moveSelection = (step: number) => {
    if (matches.length === 0) return;

    setSelected((selected + step + matches.length) % matches.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Tab") {
      if (!ghost) return;

      event.preventDefault();
      setQuery(query + ghost);
      return;
    }

    if (event.key === "Escape") {
      setQuery("");
      return;
    }

    if (event.key !== "Enter") return;
    if (!current) return;

    router.push(current.href);
  };

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="home-import-field flex h-14 min-w-0 shrink-0 cursor-text sm:flex-1 items-center gap-3 rounded-2xl px-5 font-mono text-[14px] sm:max-w-xl">
          <SearchIcon
            aria-hidden
            className="size-4 shrink-0 text-fd-muted-foreground"
          />
          <span className="home-scroll-x flex min-w-0 items-center overflow-x-auto whitespace-pre">
            <span className="home-suggest-kw">import</span>
            <span> {"{ }"} </span>
            <span className="home-suggest-kw">from</span>
            <span className="home-suggest-str"> "semola/</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(0);
              }}
              onKeyDown={onKeyDown}
              aria-label="Filter modules"
              aria-describedby={summaryId}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              className="home-suggest-input home-suggest-str bg-transparent p-0 outline-none placeholder:text-fd-muted-foreground/50"
              style={{ width: `${inputWidth}ch` }}
            />
            <span aria-hidden className="home-suggest-ghost">
              {ghost}
            </span>
            <span className="home-suggest-str">"</span>
          </span>
        </label>

        <p
          id={summaryId}
          aria-live="polite"
          className="home-label px-1 sm:text-right"
        >
          <FilterSummary
            needle={needle}
            matchCount={matches.length}
            total={modules.length}
          />
        </p>
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        {modules.map((module) => {
          const Icon = readModuleIcon(module.slug);
          let dimmed = false;

          if (needle) dimmed = !matches.includes(module);

          return (
            <li key={module.slug}>
              <Link
                href={module.href}
                data-dimmed={dimmed}
                data-selected={module === current}
                onPointerMove={trackSpotlight}
                className="home-grid-tile relative flex h-full items-start gap-4 rounded-2xl p-4 sm:flex-col sm:gap-0 sm:p-5"
              >
                <span className="flex shrink-0 items-start justify-between sm:w-full">
                  <span className="home-grid-icon grid size-9 place-items-center rounded-[10px]">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <ArrowUpRightIcon className="home-grid-arrow size-4 text-wheat max-sm:hidden" />
                </span>
                <span className="min-w-0 sm:mt-6">
                  <span className="block font-mono text-[13.5px] font-medium">
                    <SlugLabel slug={module.slug} needle={needle} />
                  </span>
                  <span className="mt-1 block text-[13.5px] leading-relaxed text-fd-muted-foreground sm:mt-1.5">
                    {module.blurb}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
