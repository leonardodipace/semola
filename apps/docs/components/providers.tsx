"use client";

import "@/components/theme-script-warning-patch";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <RootProvider>{children}</RootProvider>;
}
