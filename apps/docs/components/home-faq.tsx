import { PlusIcon } from "lucide-react";
import { packageVersion } from "@/lib/shared";

const faqs = [
  {
    question: "Does Semola work on Node.js?",
    answer:
      "Semola is built for Bun. Modules that serve HTTP or talk to Redis or SQL use Bun's built-in clients. Modules like schema, errors, policy, and i18n are plain TypeScript and do not call Bun APIs.",
  },
  {
    question: "Do I need Redis or a database?",
    answer:
      "Only for the modules that store state. queue, workflow, cache, and the Redis transport of pubsub need Redis, and orm needs SQLite or Postgres. api, policy, i18n, and in-process cron run with no infrastructure at all.",
  },
  {
    question: "Which validation libraries can I use?",
    answer:
      "Any library that implements Standard Schema, including Zod, Valibot, and ArkType. semola/schema ships in the package, so you can start without installing a validator. OpenAPI output needs schemas that can describe themselves as JSON Schema, which semola/schema and Zod 4 both do.",
  },
  {
    question: "Will unused modules end up in my app?",
    answer:
      "No. Every module is a separate entry point such as semola/api or semola/queue, and only the modules you import are loaded.",
  },
  {
    question: "Is Semola stable?",
    answer: `Semola is pre-1.0 (currently v${packageVersion}). APIs can still change between minor versions, so pin your version and read the release notes before upgrading.`,
  },
  {
    question: "How is it licensed?",
    answer:
      "MIT. Use it in commercial and open source projects, fork it, and ship it.",
  },
  {
    question: "Can AI coding tools read the docs?",
    answer:
      "Yes. The full documentation is served as plain text at /llms.txt and /llms-full.txt, and every docs page has a button that copies it as Markdown.",
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
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD for SEO
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
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
