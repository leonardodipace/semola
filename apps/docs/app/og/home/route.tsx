import { ImageResponse } from "next/og";
import { appName, appTagline } from "@/lib/shared";

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
        background: "#1a1610",
        color: "#f5efe4",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          fontSize: 36,
          fontWeight: 600,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#c4a574",
          }}
        />
        {appName}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 650,
            lineHeight: 1.1,
            maxWidth: 980,
          }}
        >
          {appTagline}
        </div>
        <div style={{ fontSize: 28, color: "#c9bba6", maxWidth: 860 }}>
          Typed APIs, queues, workflows, and an ORM. One install, zero
          dependencies.
        </div>
      </div>
      <div style={{ fontSize: 24, color: "#a8967e" }}>
        semo.la · bun add semola
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}
