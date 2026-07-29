import type { BaseLayoutProps, LinkItemType } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <img
        src="/logo.png"
        alt=""
        width={28}
        height={28}
        className="size-7 rounded-md"
      />
      <span>{appName}</span>
    </span>
  );
}

function NpmIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden
    >
      <title>npm</title>
      <path d="M0 0v24h24V0H0zm19.2 19.2h-4.8V8.4h-4.8v10.8H4.8V4.8h14.4v14.4z" />
    </svg>
  );
}

const navLinks: LinkItemType[] = [
  {
    text: "Documentation",
    url: "/docs",
    active: "nested-url",
    on: "nav",
  },
  {
    type: "icon",
    label: "npm",
    text: "npm",
    url: "https://www.npmjs.com/package/semola",
    external: true,
    secondary: true,
    icon: <NpmIcon />,
  },
];

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
      url: "/",
    },
    links: navLinks,
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}

export function homeOptions(): BaseLayoutProps {
  return baseOptions();
}
