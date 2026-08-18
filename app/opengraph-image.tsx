import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getPublicSeoCopy } from "@/lib/seo/copy";
import { PUBLIC_OG_IMAGE_CONTENT_TYPE, PUBLIC_OG_IMAGE_SIZE } from "@/lib/seo/site";

export const alt = getPublicSeoCopy("ru").ogImageAlt;
export const size = PUBLIC_OG_IMAGE_SIZE;
export const contentType = PUBLIC_OG_IMAGE_CONTENT_TYPE;

export default async function OpenGraphImage() {
  const copy = getPublicSeoCopy("ru");
  const page = copy.pages["/"];
  let iconSrc: string | null = null;
  try {
    const iconBuffer = await readFile(
      path.join(process.cwd(), "public", "brand", "negotaitions-icon-256.png"),
    );
    iconSrc = `data:image/png;base64,${iconBuffer.toString("base64")}`;
  } catch {
    iconSrc = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#020617",
          color: "#f8fafc",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          {iconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconSrc} width={96} height={96} alt="" />
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            {copy.siteName}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              display: "flex",
              fontSize: 52,
              fontWeight: 700,
              lineHeight: 1.15,
              maxWidth: 980,
            }}
          >
            {page.title.replace(`${copy.siteName} — `, "")}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              lineHeight: 1.4,
              color: "#cbd5e1",
              maxWidth: 980,
            }}
          >
            {page.description}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#22d3ee",
            letterSpacing: "0.04em",
          }}
        >
          negotaitions.ru
        </div>
      </div>
    ),
    {
      ...PUBLIC_OG_IMAGE_SIZE,
    },
  );
}
