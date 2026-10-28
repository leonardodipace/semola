import {
  ActivityIcon,
  BracesIcon,
  ClockIcon,
  DatabaseIcon,
  InboxIcon,
  LanguagesIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  PackageIcon,
  RadioTowerIcon,
  RouteIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  WorkflowIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";

const moduleIcons: Record<string, LucideIcon> = {
  api: RouteIcon,
  queue: InboxIcon,
  pubsub: RadioTowerIcon,
  cron: ClockIcon,
  workflow: WorkflowIcon,
  orm: DatabaseIcon,
  cache: ZapIcon,
  policy: ShieldCheckIcon,
  i18n: LanguagesIcon,
  schema: BracesIcon,
  errors: TriangleAlertIcon,
  logging: ScrollTextIcon,
  otel: ActivityIcon,
  prompts: MessageSquareTextIcon,
  cli: SquareTerminalIcon,
  extra: WrenchIcon,
};

export const readModuleIcon = (slug: string) => {
  return moduleIcons[slug] ?? PackageIcon;
};
