import { ImageResponse } from "next/og";
import { appName, appOgLine, appTagline } from "@/lib/shared";

export const revalidate = false;

export function GET() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "64px",
        background: "#0f1420",
        color: "#f4f1ea",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          fontSize: 36,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#c26a1a",
          }}
        />
        {appName}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.05,
            maxWidth: 980,
            letterSpacing: "-0.03em",
          }}
        >
          {appTagline}
        </div>
        <div style={{ fontSize: 28, color: "#a8b0c0", maxWidth: 860 }}>
          {appOgLine}
        </div>
      </div>
      <div style={{ fontSize: 24, color: "#e8a84a" }}>
        semo.la · bun add semola
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    },
  );
}
