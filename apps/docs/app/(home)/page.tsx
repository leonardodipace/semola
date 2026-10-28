import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HomeBuild } from "@/components/home-build";
import { HomeContract } from "@/components/home-contract";
import { HomeFaq } from "@/components/home-faq";
import { HomeHeroShot } from "@/components/home-hero-shot";
import { HomeImportTicker } from "@/components/home-import-ticker";
import { HomeModuleGrid } from "@/components/home-module-grid";
import { HomePrinciples } from "@/components/home-principles";
import { HomeStory } from "@/components/home-story";
import { InstallCommand } from "@/components/install-command";
import { Reveal } from "@/components/reveal";
import { listGridModules } from "@/lib/home-modules";
import {
  appDescription,
  appName,
  appTagline,
  githubUrl,
  homeOgImagePath,
  npmUrl,
  packageVersion,
  siteUrl,
} from "@/lib/shared";

export const metadata: Metadata = {
  title: {
    absolute: `${appName} · ${appTagline}`,
  },
  description: appDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: `${appName} · ${appTagline}`,
    description: appDescription,
    url: siteUrl,
    images: [
      {
        url: homeOgImagePath,
        width: 1200,
        height: 630,
        alt: `${appName} - ${appTagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${appName} · ${appTagline}`,
    description: appDescription,
    images: [homeOgImagePath],
  },
};

const releasesUrl = `${githubUrl}/releases`;

const heroFacts = [
  "Zero dependencies",
  "Standard Schema",
  "Per-module imports",
  "MIT licensed",
];

const footerLinks = [
  {
    title: "Product",
    links: [
      { label: "Getting started", href: "/docs/getting-started" },
      { label: "Modules", href: "/#modules" },
      { label: "Examples", href: "/#examples" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "API", href: "/docs/api" },
      { label: "Queue", href: "/docs/queue" },
      { label: "ORM", href: "/docs/orm" },
      { label: "Workflow", href: "/docs/workflow" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "GitHub", href: githubUrl },
      { label: "npm", href: npmUrl },
      { label: "Releases", href: releasesUrl },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
];

const primaryButtonClass =
  "home-press home-primary-btn home-ease inline-flex h-11 items-center gap-2 rounded-full pr-5 pl-6 text-sm font-medium transition-[background-color,transform]";

const textLinkClass =
  "home-press home-ease mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-wheat transition-transform";

function FooterLink({ href, label }: { href: string; label: string }) {
  const className = "home-hover-fg home-ease transition-colors";

  if (href.startsWith("http")) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {label}
      </a>
    );
  }

  if (href.endsWith(".txt")) {
    return (
      <a href={href} className={className}>
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

function SectionLabel({ index, label }: { index: string; label: string }) {
  return (
    <p className="home-label">
      <span className="text-wheat">{index}</span>
      <span className="mx-2">/</span>
      {label}
    </p>
  );
}

function SectionHeader({
  index,
  label,
  title,
  children,
}: {
  index: string;
  label: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Reveal className="mb-14 flex flex-col gap-6 sm:mb-20 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
      <div>
        <SectionLabel index={index} label={label} />
        <h2 className="home-title mt-5 max-w-3xl text-4xl font-semibold text-balance sm:text-6xl">
          {title}
        </h2>
      </div>
      {children}
    </Reveal>
  );
}

function SectionAside({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-sm shrink-0 text-lg leading-relaxed text-fd-muted-foreground">
      {children}
    </p>
  );
}

export default function HomePage() {
  return (
    <div className="relative -mt-14 flex flex-1 flex-col">
      <section className="relative overflow-hidden pt-14">
        <div
          aria-hidden
          className="home-dots pointer-events-none absolute inset-x-0 top-0 h-[52rem]"
        />

        <div className="relative mx-auto w-full max-w-7xl px-6 pt-16 sm:pt-24 lg:pt-28">
          <a
            href={releasesUrl}
            target="_blank"
            rel="noreferrer"
            className="home-enter home-badge home-press home-ease inline-flex h-8 items-center gap-2.5 rounded-full pr-3 pl-1 text-xs transition-[background-color,transform]"
          >
            <span className="rounded-full bg-fd-foreground px-2 py-0.5 font-mono text-[11px] text-fd-background">
              v{packageVersion}
            </span>
            <span className="text-fd-muted-foreground">Release notes</span>
            <ArrowRightIcon className="home-arrow size-3 text-fd-muted-foreground" />
          </a>

          <h1 className="home-enter home-enter-1 home-display mt-8 text-[clamp(2.6rem,6.2vw,5.75rem)] font-semibold">
            Ship the backend,
            <br />
            <span className="home-serif">not the glue.</span>
          </h1>

          <div className="mt-10 flex flex-col gap-8 lg:mt-12 lg:flex-row lg:items-end lg:justify-between">
            <div className="home-enter home-enter-2 max-w-xl">
              <p className="text-lg leading-relaxed text-fd-muted-foreground">
                Semola is one type-safe toolkit for routes with OpenAPI, queues,
                workflows, an ORM, auth policies, and the small tools around
                them. Designed together, typed end to end.
              </p>
              <ul className="home-label home-facts mt-6 flex flex-wrap items-center gap-y-1">
                {heroFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
            <div className="home-enter home-enter-3 flex flex-wrap items-center gap-3">
              <Link href="/docs/getting-started" className={primaryButtonClass}>
                Start building
                <ArrowRightIcon className="home-arrow size-4" />
              </Link>
              <InstallCommand />
            </div>
          </div>
        </div>

        <div className="home-enter home-enter-4 relative mx-auto mt-16 w-full max-w-7xl px-4 pb-24 sm:mt-20 sm:px-6 sm:pb-28">
          <HomeHeroShot />
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pt-8 pb-28 sm:pb-36">
        <SectionHeader
          index="01"
          label="Composable"
          title={
            <>
              Add features,{" "}
              <span className="home-serif">not dependencies.</span>
            </>
          }
        >
          <SectionAside>
            Pick what this service needs. server.ts grows with every import.
            package.json does not.
          </SectionAside>
        </SectionHeader>
        <Reveal>
          <HomeBuild />
        </Reveal>
      </section>

      <section className="border-y border-fd-border bg-fd-card/40">
        <div className="mx-auto w-full max-w-7xl px-6 py-28 sm:py-36">
          <SectionHeader
            index="02"
            label="One definition"
            title={
              <>
                Write the route once.{" "}
                <span className="home-serif">Use it everywhere.</span>
              </>
            }
          >
            <SectionAside>
              One route definition validates requests, types the handler, and
              feeds a client, an OpenAPI document, and your tests.
            </SectionAside>
          </SectionHeader>
          <HomeContract />
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-28 sm:py-36">
        <SectionHeader
          index="03"
          label="Principles"
          title={
            <>
              Built on a few <span className="home-serif">stubborn rules.</span>
            </>
          }
        />
        <HomePrinciples />
      </section>

      <section
        id="examples"
        className="mx-auto w-full max-w-7xl scroll-mt-20 px-6 pb-28 sm:pb-36"
      >
        <SectionHeader
          index="04"
          label="In practice"
          title={
            <>
              The rest of the backend,{" "}
              <span className="home-serif">same shape.</span>
            </>
          }
        >
          <SectionAside>
            A constructor, a few options, and types that follow your data. Learn
            one module and the next one reads the same way.
          </SectionAside>
        </SectionHeader>
        <Reveal>
          <HomeStory />
        </Reveal>
      </section>

      <section
        id="modules"
        className="scroll-mt-14 border-y border-fd-border bg-fd-card/40"
      >
        <div className="mx-auto w-full max-w-7xl px-6 py-28 sm:py-36">
          <SectionHeader
            index="05"
            label="Modules"
            title={
              <>
                Every module. <span className="home-serif">One install.</span>
              </>
            }
          >
            <SectionAside>
              Each module has its own import path, so a service only loads what
              it uses. Start typing to find the one you need.
            </SectionAside>
          </SectionHeader>
          <Reveal>
            <HomeModuleGrid modules={listGridModules()} />
          </Reveal>
        </div>
      </section>

      <section id="faq" className="scroll-mt-14">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 px-6 py-28 sm:py-36 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <Reveal className="lg:sticky lg:top-28 lg:self-start">
            <SectionLabel index="06" label="FAQ" />
            <h2 className="home-title mt-5 text-4xl font-semibold sm:text-6xl">
              Before you <span className="home-serif">commit.</span>
            </h2>
            <p className="mt-6 max-w-sm text-lg leading-relaxed text-fd-muted-foreground">
              Straight answers about runtimes, infrastructure, and what pre-1.0
              means here.
            </p>
            <a
              href={`${githubUrl}/issues`}
              target="_blank"
              rel="noreferrer"
              className={textLinkClass}
            >
              Ask on GitHub
              <ArrowRightIcon className="home-arrow size-3.5" />
            </a>
          </Reveal>
          <Reveal>
            <HomeFaq />
          </Reveal>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-fd-border">
        <div
          aria-hidden
          className="home-sunrise pointer-events-none absolute inset-x-0 top-1/3 mx-auto h-1/2 max-w-4xl opacity-60"
        />
        <Reveal className="relative mx-auto flex max-w-3xl flex-col items-center px-6 py-32 text-center sm:py-44">
          <img
            src="/logo.png"
            alt=""
            width={64}
            height={64}
            className="mb-10 size-16 drop-shadow-[0_18px_30px_color-mix(in_oklab,var(--color-crust)_40%,transparent)]"
          />
          <h2 className="home-display text-5xl font-semibold sm:text-7xl">
            Start with <span className="home-serif">one import.</span>
          </h2>
          <HomeImportTicker />
          <p className="mt-6 max-w-md text-lg text-balance text-fd-muted-foreground">
            Add the package, use the module you need today, and leave the rest
            for the day you need it.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/docs/getting-started" className={primaryButtonClass}>
              Start building
              <ArrowRightIcon className="home-arrow size-4" />
            </Link>
            <InstallCommand />
          </div>
        </Reveal>
      </section>

      <footer className="relative overflow-hidden border-t border-fd-border">
        <div className="mx-auto max-w-7xl px-6 pt-16">
          <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2">
              <Link
                href="/"
                className="home-press home-ease inline-flex items-center gap-2 text-base font-semibold tracking-tight transition-transform"
              >
                <img
                  src="/logo.png"
                  alt=""
                  width={28}
                  height={28}
                  className="size-7"
                />
                Semola
              </Link>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-fd-muted-foreground">
                The type-safe backend toolkit for TypeScript. Made from durum
                wheat and strict mode.
              </p>
            </div>

            {footerLinks.map((group) => (
              <div key={group.title}>
                <h3 className="home-label mb-4">{group.title}</h3>
                <ul className="space-y-2.5 text-sm text-fd-muted-foreground">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <FooterLink href={link.href} label={link.label} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-16 flex flex-col gap-2 text-xs text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>MIT License · v{packageVersion}</p>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="home-hover-fg home-ease font-mono transition-colors"
            >
              leonardodipace/semola
            </a>
          </div>
        </div>

        <p
          aria-hidden
          className="home-wordmark pointer-events-none mx-auto mt-6 -mb-[0.12em] max-w-7xl px-4 text-center text-[clamp(6rem,24vw,22rem)] font-semibold select-none"
        >
          semola
        </p>
      </footer>
    </div>
  );
}
