"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const INTERVAL_MS = 5000;

const examples = [
  {
    id: "api",
    label: "API",
    file: "hello.ts",
    code: `import { Api } from "semola/api";
import { z } from "zod";

const api = new Api();

api.defineRoute({
  path: "/hello/:name",
  method: "GET",
  request: {
    params: z.object({ name: z.string() }),
  },
  response: {
    200: z.object({ message: z.string() }),
  },
  handler: async (c) => {
    return c.json(200, {
      message: \`Hello, \${c.req.params.name}!\`,
    });
  },
});

api.serve(3000);`,
  },
  {
    id: "queue",
    label: "Queue",
    file: "jobs.ts",
    code: `import { Queue } from "semola/queue";

const queue = new Queue({
  name: "emails",
  redis: redisClient,
  concurrency: 4,
  handler: async (data) => {
    await sendEmail(data);
  },
});

await queue.enqueue({
  to: "user@example.com",
  subject: "Welcome",
});`,
  },
  {
    id: "errors",
    label: "Errors",
    file: "fetch.ts",
    code: `import { mightThrow } from "semola/errors";

const [error, data] = await mightThrow(
  fetch("https://api.example.com"),
);

if (error) {
  console.error("Request failed:", error);
  return;
}

console.log("Success:", data);`,
  },
  {
    id: "orm",
    label: "ORM",
    file: "users.ts",
    code: `import {
  createOrm,
  defineTable,
  string,
  uuid,
} from "semola/orm";

const users = defineTable("users", {
  id: uuid("id").primaryKey().notNull(),
  email: string("email").unique().notNull(),
});

const db = createOrm({
  adapter: "sqlite",
  url: ":memory:",
  tables: { users },
});

const user = await db.users.findFirst({
  where: { email: "hi@semola.dev" },
});`,
  },
  {
    id: "workflow",
    label: "Workflow",
    file: "order.ts",
    code: `import { defineWorkflow } from "semola/workflow";

const fulfillOrder = defineWorkflow<{ orderId: string }>({
  name: "fulfill-order",
  redis: redisClient,
  handler: async ({ input, step }) => {
    const payment = await step("charge", async () => {
      return charge(input.orderId);
    });

    await step("ship", async () => {
      await ship(payment.orderId);
    });
  },
});

await fulfillOrder.start({ orderId: "ord_123" });`,
  },
] as const;

export function HomeShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [entered, setEntered] = useState(true);
  const [slideHeights, setSlideHeights] = useState<number[]>(() =>
    examples.map(() => 0),
  );
  const [panelHeight, setPanelHeight] = useState<number>();
  const [reservedHeight, setReservedHeight] = useState<number>();

  const isFirstRender = useRef(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const goTo = (index: number) => {
    if (index === active) return;

    setDirection(index > active ? 1 : -1);
    setActive(index);
  };

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setEntered(false);

    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setEntered(true);
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useLayoutEffect(() => {
    const observers = slideRefs.current.map((element, index) => {
      if (!element) return;

      const sync = () => {
        const height = element.offsetHeight;

        setSlideHeights((current) => {
          if (current[index] === height) return current;

          const next = [...current];
          next[index] = height;
          return next;
        });
      };

      sync();

      const observer = new ResizeObserver(sync);
      observer.observe(element);
      return observer;
    });

    return () => {
      for (const observer of observers) {
        observer?.disconnect();
      }
    };
  }, []);

  useLayoutEffect(() => {
    const height = slideHeights[active];

    if (!height) return;

    setPanelHeight(height);
  }, [active, slideHeights]);

  useLayoutEffect(() => {
    const card = cardRef.current;

    if (!card) return;

    setReservedHeight((current) =>
      Math.max(current ?? 0, card.offsetHeight),
    );
  }, [panelHeight, active]);

  useEffect(() => {
    if (paused) return;

    const id = window.setInterval(() => {
      setDirection(1);
      setActive((current) => (current + 1) % examples.length);
    }, INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [paused, active]);

  return (
    <div
      className="home-fade-in flex flex-col justify-start"
      style={
        reservedHeight
          ? { minHeight: reservedHeight }
          : undefined
      }
    >
      <div
        ref={cardRef}
        className="overflow-hidden rounded-2xl border border-fd-border bg-fd-card/80 shadow-2xl shadow-black/20 backdrop-blur-sm"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setPaused(false);
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-fd-border px-3 py-2 sm:px-4">
          <span className="size-2.5 shrink-0 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 shrink-0 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 shrink-0 rounded-full bg-[#28c840]" />
          <div className="ml-2 flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {examples.map((item, index) => {
              const isActive = index === active;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTo(index)}
                  className={`relative shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "text-wheat"
                      : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground"
                  }`}
                >
                  {item.label}
                  {isActive ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-wheat/20"
                    >
                      <span
                        key={`${active}-${paused ? "paused" : "play"}`}
                        className={`absolute inset-y-0 left-0 rounded-full bg-wheat ${
                          paused
                            ? "w-full"
                            : "home-showcase-progress"
                        }`}
                      />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="relative h-9 overflow-hidden border-b border-fd-border">
          {examples.map((item, index) => (
            <div
              key={item.id}
              className={`absolute inset-0 flex items-center px-4 font-mono text-xs text-fd-muted-foreground transition-[opacity,transform] duration-400 ease-out ${
                index === active && entered
                  ? "translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-1.5 opacity-0"
              }`}
              aria-hidden={index !== active}
            >
              {item.file}
            </div>
          ))}
        </div>

        <div
          className="home-showcase-code relative overflow-hidden text-left transition-[height] duration-400 ease-out [&_.line]:px-0"
          style={
            panelHeight
              ? { height: panelHeight }
              : undefined
          }
        >
          {examples.map((item, index) => {
            const isActive = index === active;

            return (
              <div
                key={item.id}
                ref={(element) => {
                  slideRefs.current[index] = element;
                }}
                className={`absolute inset-x-0 top-0 overflow-hidden transition-[opacity,transform] duration-400 ease-out ${
                  isActive && entered
                    ? "z-10 translate-x-0 opacity-100"
                    : isActive
                      ? `z-10 opacity-0 ${direction > 0 ? "translate-x-5" : "-translate-x-5"}`
                      : "pointer-events-none z-0 translate-x-0 opacity-0"
                }`}
                aria-hidden={!isActive}
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
                  options={{
                    themes: {
                      light: "github-light",
                      dark: "github-dark",
                    },
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
