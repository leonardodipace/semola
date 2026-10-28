"use client";

import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const OPEN_DELAY_MS = 90;
const CLOSE_DELAY_MS = 120;
const TOKEN_GAP_PX = 6;
const VIEWPORT_GAP_PX = 8;

const hiddenPosition: CSSProperties = { visibility: "hidden", top: 0, left: 0 };

export function HoverToken({
  tip,
  tone,
  className,
  style,
  children,
}: {
  tip: ReactNode;
  tone: "info" | "error";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const tokenRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(undefined);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(hiddenPosition);
  const id = useId();

  useEffect(() => {
    setMounted(true);

    return () => window.clearTimeout(timer.current);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(hiddenPosition);
      return;
    }

    if (!mounted) return;

    const place = () => {
      const token = tokenRef.current;
      const tooltip = tipRef.current;

      if (!token) return;
      if (!tooltip) return;

      const rect = token.getBoundingClientRect();
      const maxLeft = window.innerWidth - tooltip.offsetWidth - VIEWPORT_GAP_PX;
      let top = rect.bottom + TOKEN_GAP_PX;

      if (top + tooltip.offsetHeight > window.innerHeight - VIEWPORT_GAP_PX) {
        top = rect.top - tooltip.offsetHeight - TOKEN_GAP_PX;
      }

      setPosition({
        top,
        left: Math.max(VIEWPORT_GAP_PX, Math.min(rect.left, maxLeft)),
      });
    };

    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);

    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open, mounted]);

  const scheduleOpen = (next: boolean, delayMs: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delayMs);
  };

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;

    scheduleOpen(true, OPEN_DELAY_MS);
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;

    scheduleOpen(false, CLOSE_DELAY_MS);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;

    setOpen(!open);
  };

  let tooltip: ReactNode = null;
  let describedBy: string | undefined;

  if (open) {
    describedBy = id;

    if (mounted) {
      tooltip = createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          data-tone={tone}
          className="home-tip"
          style={position}
        >
          {tip}
        </div>,
        document.body,
      );
    }
  }

  return (
    <>
      <button
        ref={tokenRef}
        type="button"
        data-tone={tone}
        data-open={open}
        aria-describedby={describedBy}
        className="home-token"
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerUp={onPointerUp}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;

          setOpen(false);
        }}
      >
        <span className={className} style={style}>
          {children}
        </span>
      </button>
      {tooltip}
    </>
  );
}
