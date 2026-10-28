"use client";

import { type RefObject, useEffect, useState } from "react";

export const useInView = (
  ref: RefObject<Element | null>,
  { threshold = 0.3, once = false }: { threshold?: number; once?: boolean } = {},
) => {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;

        if (!visible) {
          if (!once) setInView(false);
          return;
        }

        setInView(true);

        if (once) observer.disconnect();
      },
      { threshold },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref, threshold, once]);

  return inView;
};
