import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
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

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument",
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
    "Bun framework",
    "Bun backend",
    "TypeScript backend toolkit",
    "type-safe API",
    "typed API client",
    "OpenAPI",
    "Standard Schema",
    "Redis queue",
    "Bun ORM",
    "durable workflows",
    "OpenTelemetry",
    "zero dependency",
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
      className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col font-sans">
        <JsonLd />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
