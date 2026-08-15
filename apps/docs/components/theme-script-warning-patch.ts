"use client";

/**
 * next-themes (via Fumadocs RootProvider) injects an inline theme script.
 * React 19 warns about <script> in the component tree; the script still runs on SSR.
 * Filter only that known false positive in development.
 */
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const original = console.error;

  console.error = (...args: unknown[]) => {
    const message = args[0];

    if (
      typeof message === "string" &&
      message.includes("Encountered a script tag while rendering React component")
    ) {
      return;
    }

    original.apply(console, args);
  };
}
