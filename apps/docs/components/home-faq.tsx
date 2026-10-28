import { PlusIcon } from "lucide-react";
import { JsonLdScript } from "@/components/json-ld";
import { packageVersion } from "@/lib/shared";

const faqs = [
  {
    question: "What is Semola?",
    answer:
      "Semola is a TypeScript backend toolkit. Instead of installing a router, a queue, an ORM, and three helper libraries, you install one package with an empty dependencies field. Modules cover typed REST APIs with OpenAPI, Redis queues, durable workflows, SQL, auth policies, caching, i18n, and smaller utilities - each imported on its own path like semola/api or semola/queue.",
  },
  {
    question: "How do I install it?",
    answer:
      "bun add semola. npm, pnpm, and yarn work too. Then import only the modules you need. The getting started guide builds a small typed API from scratch.",
  },
  {
    question: "Is this a framework?",
    answer:
      "No. There is no app shell you have to live inside. You import the pieces you want, compose them in your own server.ts, and leave the rest out. It is closer to a set of libraries that share types and habits than to a framework with opinions about folders.",
  },
  {
    question: "Does it run on Node.js?",
    answer:
      "Some modules currently use Bun APIs for HTTP, Redis, and SQL, so those need Bun today. Schema, errors, policy, and i18n are plain TypeScript and do not call Bun. Check each module page for what it needs.",
  },
  {
    question: "Do I need Redis or a database on day one?",
    answer:
      "Only if you use the modules that store state. Queue, workflow, cache, and Redis pub/sub need Redis. The ORM needs SQLite or Postgres. API routes, policies, i18n, and in-process cron run with nothing extra.",
  },
  {
    question: "Can I keep using Zod?",
    answer:
      "Yes. Anything that implements Standard Schema works - Zod, Valibot, ArkType, and the built-in semola/schema. Drop schemas into the same slots. For OpenAPI you need schemas that can emit JSON Schema; semola/schema and Zod 4 both do.",
  },
  {
    question: "Will unused modules bloat my bundle?",
    answer:
      "No. Each module is its own entry point. Importing semola/api does not load the ORM, the CLI, or anything else. What you do not import is not there.",
  },
  {
    question: "How stable is it?",
    answer: `Pre-1.0 - currently v${packageVersion}. APIs can still move between minor versions. Pin the version you ship with and read the release notes before you bump.`,
  },
  {
    question: "What about the license?",
    answer:
      "MIT. Commercial projects, open source, forks - all fine.",
  },
  {
    question: "Can coding agents read the docs?",
    answer:
      "Yes. Full docs are plain text at /llms.txt and /llms-full.txt, and every docs page can copy itself as Markdown.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export function HomeFaq() {
  return (
    <>
      <JsonLdScript data={faqJsonLd} />
      <div className="border-t border-fd-border">
        {faqs.map((faq, index) => (
          <details
            key={faq.question}
            open={index === 0}
            className="home-faq border-b border-fd-border"
          >
            <summary className="home-faq-summary flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-lg font-medium tracking-tight sm:text-xl">
              {faq.question}
              <PlusIcon
                aria-hidden
                className="home-faq-icon size-5 shrink-0 text-fd-muted-foreground"
                strokeWidth={1.5}
              />
            </summary>
            <p className="max-w-2xl pb-7 text-[15px] leading-relaxed text-fd-muted-foreground sm:text-base">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </>
  );
}
