import {
  appDescription,
  appName,
  appTagline,
  githubUrl,
  npmUrl,
  packageVersion,
  siteUrl,
} from "@/lib/shared";

const sameAs = [githubUrl, npmUrl, siteUrl];

const author = {
  "@type": "Person",
  name: "Leonardo Dipace",
  url: "https://github.com/leonardodipace",
};

const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: appName,
  alternateName: appTagline,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Cross-platform",
  url: siteUrl,
  description: appDescription,
  downloadUrl: npmUrl,
  installUrl: npmUrl,
  softwareVersion: packageVersion,
  codeRepository: githubUrl,
  license: "https://opensource.org/licenses/MIT",
  author,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Typed REST APIs with OpenAPI",
    "Redis job queues with retries",
    "Durable workflows that resume after crashes",
    "Typed ORM for SQLite and Postgres",
    "Auth policies with allow and forbid rules",
    "Zero runtime dependencies",
    "Per-module tree-shakeable imports",
  ],
  sameAs,
};

const softwareSourceCode = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  name: appName,
  description: appDescription,
  url: siteUrl,
  codeRepository: githubUrl,
  downloadUrl: npmUrl,
  programmingLanguage: ["TypeScript", "JavaScript"],
  license: "https://opensource.org/licenses/MIT",
  author,
  sameAs,
};

const webSite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: appName,
  alternateName: appTagline,
  url: siteUrl,
  description: appDescription,
  inLanguage: "en-US",
  publisher: {
    "@type": "Organization",
    name: appName,
    url: siteUrl,
    logo: `${siteUrl}/logo.png`,
    sameAs,
  },
};

export function JsonLdScript({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD for SEO
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function JsonLd() {
  return (
    <>
      <JsonLdScript data={softwareApplication} />
      <JsonLdScript data={softwareSourceCode} />
      <JsonLdScript data={webSite} />
    </>
  );
}
