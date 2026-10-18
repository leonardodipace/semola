import type { Metadata } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import { JsonLd } from "@/components/json-ld";
import { Providers } from "@/components/providers";
import {
  appDescription,
  appName,
  appTagline,
  gitConfig,
  githubUrl,
  homeOgImagePath,
  siteUrl,
} from "@/lib/shared";
import "./global.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${appName} · ${appTagline}`,
    template: `%s · ${appName}`,
  },
  description: appDescription,
  applicationName: appName,
  category: "technology",
  keywords: [
    "Semola",
    "Bun",
    "TypeScript",
    "type-safe API",
    "OpenAPI",
    "Redis queue",
    "ORM",
    "durable workflows",
    "zero dependency",
    "backend toolkit",
  ],
  icons: {
    icon: [{ url: "/logo.png", type: "image/png" }],
    apple: [{ url: "/logo.png", type: "image/png" }],
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: appName,
    title: `${appName} · ${appTagline}`,
    description: appDescription,
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
  authors: [{ name: gitConfig.user, url: githubUrl }],
  creator: gitConfig.user,
  publisher: appName,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  other: {
    "npm:package": "semola",
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans">
        <JsonLd />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
