import type { ReactNode } from "react";
import { Reveal } from "@/components/reveal";
import { listModulePackages } from "@/lib/home-modules";
import { packageVersion } from "@/lib/shared";

const validatorRows = [
  { code: "email()", source: "semola/schema" },
  { code: "z.email()", source: "zod" },
  { code: "v.pipe(v.string(), v.email())", source: "valibot" },
  { code: 'type("string.email")', source: "arktype" },
];

function PrincipleCard({
  title,
  body,
  visual,
  className = "",
  delayMs = 0,
}: {
  title: string;
  body: string;
  visual: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  return (
    <Reveal delayMs={delayMs} className={className}>
      <article className="home-card flex h-full flex-col overflow-hidden rounded-2xl">
        <div
          aria-hidden
          className="relative flex h-76 items-center overflow-hidden px-7 sm:h-64 sm:px-9"
        >
          {visual}
        </div>
        <div className="mt-auto px-7 pb-8 sm:px-9 sm:pb-9">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-2 max-w-md text-[15px] leading-relaxed text-fd-muted-foreground">
            {body}
          </p>
        </div>
      </article>
    </Reveal>
  );
}

function TypeErrorVisual() {
  return (
    <div className="relative mt-2 w-full self-start pt-8 font-mono text-[13px] leading-7">
      <p>
        <span className="text-crust">return</span> c.json(
        <span className="text-wheat">201</span>, {"{"}
      </p>
      <p className="pl-5">
        <span className="home-squiggle">mesage</span>:{" "}
        <span className="text-wheat">"Welcome"</span>,
      </p>
      <p>{"});"}</p>

      <div className="home-error absolute top-[7.25rem] left-8 max-w-[24rem] rounded-xl p-3.5 font-sans text-[12.5px] leading-5 sm:left-12">
        <p>
          Object literal may only specify known properties, but{" "}
          <code className="font-mono text-crust">'mesage'</code> does not exist
          in type <code className="font-mono">{"'{ message: string; }'"}</code>.
          Did you mean to write{" "}
          <code className="font-mono text-wheat">'message'</code>?
        </p>
        <p className="mt-1.5 font-mono text-[11px] text-fd-muted-foreground">
          ts(2561)
        </p>
      </div>
    </div>
  );
}

function ValidatorsVisual() {
  return (
    <ul className="w-full space-y-2 font-mono text-[12.5px]">
      {validatorRows.map((row, index) => {
        let className =
          "home-chip flex items-center justify-between gap-4 rounded-lg px-3 py-2";

        if (index === 0) {
          className =
            "home-chip flex items-center justify-between gap-4 rounded-lg px-3 py-2 shadow-[0_0_0_1px_var(--color-wheat)]";
        }

        return (
          <li key={row.source} className={className}>
            <span className="truncate">{row.code}</span>
            <span className="shrink-0 text-[11px] text-fd-muted-foreground">
              {row.source}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PackageJsonVisual() {
  return (
    <div className="w-full font-mono text-[13px] leading-7">
      <p className="home-label mb-3">package.json</p>
      <p>{"{"}</p>
      <p className="pl-5">
        <span className="text-wheat">"dependencies"</span>: {"{"}
      </p>
      <p className="-mx-3 border-l-2 border-wheat bg-wheat/10 pr-3 pl-[calc(2.5rem+10px)]">
        <span className="text-wheat">"semola"</span>:{" "}
        <span className="text-crust">"^{packageVersion}"</span>
      </p>
      <p className="pl-5">{"}"}</p>
      <p>{"}"}</p>
    </div>
  );
}

function ImportsVisual() {
  return (
    <div className="w-full">
      <p className="font-mono text-[13px]">
        <span className="text-crust">import</span> {"{ Queue }"}{" "}
        <span className="text-crust">from</span>{" "}
        <span className="text-wheat">"semola/queue"</span>
        {";"}
      </p>
      <ul className="home-fade-b mt-6 flex flex-wrap gap-1.5 font-mono text-[11.5px]">
        {listModulePackages().map((pkg) => {
          let className =
            "rounded-md border border-dashed border-fd-border px-2 py-0.5 text-fd-muted-foreground/60";

          if (pkg === "semola/queue") {
            className =
              "rounded-md border border-wheat bg-wheat/10 px-2 py-0.5 text-wheat";
          }

          return (
            <li key={pkg} className={className}>
              {pkg}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HomePrinciples() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <PrincipleCard
        className="lg:col-span-7"
        title="Wrong response? Your editor complains first"
        body="Request bodies are typed - that part everyone does. Semola also types what you return. A typo in a field name dies in the editor, not in a 2am bug report."
        visual={<TypeErrorVisual />}
      />
      <PrincipleCard
        className="lg:col-span-5"
        delayMs={80}
        title="Keep Zod. Or don't."
        body="Slots take any Standard Schema library: Zod, Valibot, ArkType, or the built-in semola/schema. Swap later without rewriting the app."
        visual={<ValidatorsVisual />}
      />
      <PrincipleCard
        className="lg:col-span-5"
        delayMs={160}
        title="The dependencies field is empty"
        body="On purpose. bun add semola puts one line in package.json. No transitive tree to audit, pin, or wake up for on a CVE Friday."
        visual={<PackageJsonVisual />}
      />
      <PrincipleCard
        className="lg:col-span-7"
        delayMs={240}
        title="Pay only for what you import"
        body="semola/queue is not a back door into the ORM or the CLI. Each module is its own entry point, so unused code stays out of the process."
        visual={<ImportsVisual />}
      />
    </div>
  );
}
