import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CodeSnippet } from "@/components/code-snippet";
import { HomeShowcase } from "@/components/home-showcase";
import { InstallCommand } from "@/components/install-command";
import { Reveal } from "@/components/reveal";
import { homeModules } from "@/lib/home-modules";
import { appDescription, appName } from "@/lib/shared";

export const metadata: Metadata = {
  title: {
    absolute: `${appName} · Type-safe building blocks for real backends`,
  },
  description: appDescription,
};

const principles = [
  {
    title: "Type-safe by default",
    body: "Inputs, outputs, and errors stay typed end to end. Catch mistakes at compile time instead of in production logs.",
  },
  {
    title: "Easy to pick up",
    body: "Small APIs, clear names, short examples. Read a snippet, paste it in, keep shipping.",
  },
  {
    title: "One toolkit, not a pile",
    body: "APIs, jobs, data, auth, and utilities in one package. Skip the ritual of wiring half a dozen libs for every new app.",
  },
];

const footerLinks = [
  {
    title: "Docs",
    links: [
      { label: "Getting started", href: "/docs/getting-started" },
      { label: "API", href: "/docs/api" },
      { label: "Queue", href: "/docs/queue" },
      { label: "ORM", href: "/docs/orm" },
    ],
  },
  {
    title: "Package",
    links: [
      { label: "npm", href: "https://www.npmjs.com/package/semola" },
      {
        label: "GitHub",
        href: "https://github.com/leonardodipace/semola",
      },
      {
        label: "Releases",
        href: "https://github.com/leonardodipace/semola/releases",
      },
    ],
  },
];

function FooterLink({ href, label }: { href: string; label: string }) {
  const className = "home-hover-fg home-ease transition-colors";

  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

export default function HomePage() {
  return (
    <div className="relative flex flex-1 flex-col">
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="home-hero-field home-grain pointer-events-none absolute inset-x-0 top-0 h-[42rem] sm:h-[52rem]"
        />
        <div
          aria-hidden
          className="home-noise pointer-events-none absolute inset-x-0 top-0 h-[42rem] sm:h-[52rem]"
        />

        <div className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-16 pb-10 text-center sm:pt-24 sm:pb-14">
          <Image
            src="/logo.png"
            alt=""
            width={56}
            height={56}
            className="home-fade-up mb-8 size-14 rounded-xl shadow-[0_16px_40px_-18px_color-mix(in_oklab,var(--color-bran)_55%,transparent)]"
          />

          <h1 className="home-fade-up-delay-1 mb-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Type-safe building blocks for real backends.
          </h1>

          <p className="home-fade-up-delay-2 mb-10 max-w-lg text-base text-fd-muted-foreground sm:text-lg">
            APIs, queues, workflows, ORM, and more - with zero runtime
            dependencies. Import only what you use.
          </p>

          <div className="home-fade-up-delay-3 flex flex-wrap items-center justify-center gap-3">
            <InstallCommand variant="solid" />
            <Link
              href="/docs"
              className="home-press home-docs-link home-ease inline-flex items-center rounded-lg bg-wheat px-5 py-3 text-sm font-semibold text-[#2a2114] transition-[background-color,transform]"
            >
              Read the docs
            </Link>
          </div>
        </div>

        <div className="home-fade-up-delay-4 relative mx-auto w-full max-w-5xl px-0 sm:px-6 sm:pb-20">
          <HomeShowcase />
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-fd-border bg-fd-secondary/25">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_80%_at_50%_0%,var(--color-wheat-dim),transparent_65%)]"
        />
        <div className="relative mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <Reveal className="mb-12 max-w-xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Why teams reach for it
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Small surface, clear tradeoffs, no surprise lock-in.
            </p>
          </Reveal>

          <div className="grid gap-10 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-fd-border">
            {principles.map((item, index) => (
              <Reveal
                key={item.title}
                delayMs={index * 90}
                className="sm:px-8 sm:first:pl-0 sm:last:pr-0"
              >
                <p className="mb-4 font-mono text-xs tracking-wider text-wheat">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="text-lg font-semibold tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
                  {item.body}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-background">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <Reveal className="mb-12 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              One package.
              <span className="text-fd-muted-foreground"> Many imports.</span>
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Tree-shakeable modules for HTTP, jobs, data, and auth. Start with
              one path; add the rest when the app needs them.
            </p>
          </Reveal>

          <Reveal>
            <ul className="divide-y divide-fd-border border-y border-fd-border">
              {homeModules.map((item) => (
                <li key={item.pkg}>
                  <Link
                    href={item.href}
                    className="home-press home-import-row home-ease flex flex-col gap-1 px-1 py-4 transition-[background-color,transform] sm:flex-row sm:items-baseline sm:justify-between sm:gap-8 sm:px-3"
                  >
                    <code className="home-import-pkg font-mono text-sm font-medium transition-colors duration-220 ease-[var(--ease-out)] sm:text-base">
                      {item.pkg}
                    </code>
                    <span className="text-sm text-fd-muted-foreground sm:text-right">
                      {item.blurb}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <Link
                href="/docs"
                className="home-press home-ease text-sm font-medium text-wheat transition-[color,transform]"
              >
                Full documentation →
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-background">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <Reveal className="mb-14 max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              In practice
            </h2>
            <p className="mt-3 text-fd-muted-foreground">
              Same shape every time: pick a module, read a short pitch, steal
              the snippet.
            </p>
          </Reveal>

          <div className="space-y-16 sm:space-y-20">
            {homeModules.map((feature, index) => (
              <Reveal key={feature.pkg}>
                <article>
                  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="max-w-2xl">
                      <div className="mb-3 flex items-center gap-3 font-mono text-xs text-fd-muted-foreground">
                        <span className="text-wheat">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span aria-hidden className="text-fd-border">
                          /
                        </span>
                        <span>{feature.pkg}</span>
                      </div>
                      <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                        {feature.title}
                      </h3>
                      <p className="mt-2 text-fd-muted-foreground">
                        {feature.body}
                      </p>
                    </div>
                    <Link
                      href={feature.href}
                      className="home-press home-ease shrink-0 text-sm font-medium text-wheat transition-[color,transform]"
                    >
                      Docs →
                    </Link>
                  </div>
                  <CodeSnippet code={feature.code} title={feature.file} />
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-secondary/25">
        <Reveal className="mx-auto flex max-w-5xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Ready when you are
            </h2>
            <p className="mt-2 text-fd-muted-foreground">
              Install the package, open the docs, ship the first typed route.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <InstallCommand variant="solid" />
            <Link
              href="/docs/getting-started"
              className="home-press home-docs-link home-ease inline-flex items-center rounded-lg bg-wheat px-5 py-3 text-sm font-semibold text-[#2a2114] transition-[background-color,transform]"
            >
              Getting started
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-fd-border bg-fd-secondary/30">
        <div className="mx-auto max-w-5xl px-6 py-14">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <Link
                href="/"
                className="home-press home-ease inline-flex items-center gap-2 text-lg font-semibold tracking-tight transition-transform"
              >
                <Image
                  src="/logo.png"
                  alt=""
                  width={28}
                  height={28}
                  className="size-7 rounded-md"
                />
                Semola
              </Link>
              <p className="mt-3 max-w-sm text-sm text-fd-muted-foreground">
                {appDescription}
              </p>
              <div className="mt-5">
                <InstallCommand />
              </div>
            </div>

            {footerLinks.map((group) => (
              <div key={group.title}>
                <h3 className="mb-3 text-sm font-semibold">{group.title}</h3>
                <ul className="space-y-2 text-sm text-fd-muted-foreground">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <FooterLink href={link.href} label={link.label} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col gap-2 border-t border-fd-border pt-6 text-xs text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>MIT License</p>
            <a
              href="https://github.com/leonardodipace/semola"
              target="_blank"
              rel="noreferrer"
              className="home-hover-fg home-ease transition-colors"
            >
              leonardodipace/semola
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
