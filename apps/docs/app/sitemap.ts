import type { MetadataRoute } from "next";
import { docsRoute, siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

export const revalidate = false;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const docsPages = source.getPages().map((page) => {
    const isIndex = page.url === docsRoute || page.url === `${docsRoute}/`;

    return {
      url: `${siteUrl}${page.url}`,
      lastModified: now,
      changeFrequency: isIndex ? ("weekly" as const) : ("monthly" as const),
      priority: isIndex ? 0.9 : 0.7,
    };
  });

  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...docsPages,
  ];
}
