import {
  FileCodeIcon,
  FileJsonIcon,
  FolderIcon,
  PackageIcon,
} from "lucide-react";
import { CodePre, HoverCode } from "@/components/hover-code";
import { HomeHeroEditor } from "@/components/home-hero-editor";
import {
  describeError,
  heroSample,
  heroStatusSample,
  heroTypoSample,
} from "@/lib/home-code";
import { packageVersion } from "@/lib/shared";

function ExplorerRow({
  icon: Icon,
  label,
  active = false,
  indent = false,
}: {
  icon: typeof FileCodeIcon;
  label: string;
  active?: boolean;
  indent?: boolean;
}) {
  let className =
    "flex items-center gap-2 rounded-md px-2 py-1 text-fd-muted-foreground";
  let rowClassName: string | undefined;

  if (active) {
    className =
      "flex items-center gap-2 rounded-md bg-fd-background px-2 py-1 text-fd-foreground shadow-[0_0_0_1px_var(--color-fd-border)]";
  }

  if (indent) rowClassName = "pl-4";

  return (
    <li className={rowClassName}>
      <span className={className}>
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        {label}
      </span>
    </li>
  );
}

function Explorer() {
  return (
    <aside
      aria-hidden
      className="border-r border-fd-border bg-fd-card/60 p-3 text-[13px] max-lg:hidden"
    >
      <p className="home-label px-2 pt-1 pb-2">Explorer</p>
      <ul className="space-y-0.5">
        <ExplorerRow icon={FolderIcon} label="app" />
        <ExplorerRow icon={FileCodeIcon} label="server.ts" active indent />
        <ExplorerRow icon={FileJsonIcon} label="package.json" indent />
      </ul>

      <p className="home-label mt-6 px-2 pb-2">Dependencies</p>
      <div className="flex items-center gap-2 rounded-md px-2 py-1">
        <PackageIcon
          className="size-3.5 shrink-0 text-wheat"
          strokeWidth={1.75}
        />
        <span>semola</span>
        <span className="ml-auto font-mono text-[11px] text-fd-muted-foreground">
          {packageVersion}
        </span>
      </div>
    </aside>
  );
}

export function HomeHeroShot() {
  const typoError = describeError(heroTypoSample, "server.ts");
  const statusError = describeError(heroStatusSample, "server.ts");

  return (
    <div className="relative">
      <div className="home-tilt">
        <HomeHeroEditor
          code={
            <CodePre>
              <HoverCode sample={heroSample} />
            </CodePre>
          }
          typoCode={
            <CodePre>
              <HoverCode sample={heroTypoSample} />
            </CodePre>
          }
          statusCode={
            <CodePre>
              <HoverCode sample={heroStatusSample} />
            </CodePre>
          }
          sidebar={<Explorer />}
          typoError={typoError}
          statusError={statusError}
        />
      </div>
    </div>
  );
}
