import { createMDX } from "fumadocs-mdx/next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const withMDX = createMDX();

const htmlCacheControl =
  "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";
const textCacheControl =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const ogCacheControl =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: htmlCacheControl }],
      },
      {
        source: "/llms.txt",
        headers: [{ key: "Cache-Control", value: textCacheControl }],
      },
      {
        source: "/llms-full.txt",
        headers: [{ key: "Cache-Control", value: textCacheControl }],
      },
      {
        source: "/llms.mdx/:path*",
        headers: [{ key: "Cache-Control", value: textCacheControl }],
      },
      {
        source: "/og/:path*",
        headers: [{ key: "Cache-Control", value: ogCacheControl }],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default withMDX(config);

initOpenNextCloudflareForDev();
