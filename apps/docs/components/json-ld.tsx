import {
  appDescription,
  appName,
  githubUrl,
  npmUrl,
  siteUrl,
} from "@/lib/shared";

const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: appName,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Cross-platform",
  url: siteUrl,
  description: appDescription,
  downloadUrl: npmUrl,
  installUrl: npmUrl,
  codeRepository: githubUrl,
  license: "https://opensource.org/licenses/MIT",
  author: {
    "@type": "Person",
    name: "Leonardo Dipace",
    url: "https://github.com/leonardodipace",
  },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const webSite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: appName,
  url: siteUrl,
  description: appDescription,
  publisher: {
    "@type": "Organization",
    name: appName,
    url: siteUrl,
    logo: `${siteUrl}/logo.png`,
    sameAs: [githubUrl, npmUrl],
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
      <JsonLdScript data={webSite} />
    </>
  );
}
