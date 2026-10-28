"use client";

import { useEffect, useState } from "react";

const TICK_MS = 2200;

const imports = [
  { name: "Api", slug: "api" },
  { name: "Queue", slug: "queue" },
  { name: "createOrm", slug: "orm" },
  { name: "defineWorkflow", slug: "workflow" },
  { name: "PubSub", slug: "pubsub" },
  { name: "Cache", slug: "cache" },
  { name: "mightThrow", slug: "errors" },
  { name: "I18n", slug: "i18n" },
];

export function HomeImportTicker() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % imports.length);
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, []);

  const current = imports[index] ?? imports[0];

  return (
    <p className="home-window mt-8 inline-flex h-11 items-center rounded-full px-5 font-mono text-sm whitespace-pre sm:text-[15px]">
      <span className="home-suggest-kw">import</span>
      <span> {"{ "}</span>
      <span key={`name-${index}`} className="home-ticker-swap text-wheat">
        {current?.name}
      </span>
      <span>{" } "}</span>
      <span className="home-suggest-kw">from</span>
      <span className="home-suggest-str"> "semola/</span>
      <span key={`slug-${index}`} className="home-ticker-swap home-suggest-str">
        {current?.slug}
      </span>
      <span className="home-suggest-str">"</span>
    </p>
  );
}
