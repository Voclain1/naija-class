import { ImageResponse } from "next/og";

import { WEBSITE_ACCENTS } from "@school-kit/types";

import { loadSchool } from "@/lib/school-site";

// The picture shown when a school's page is shared on WhatsApp, Facebook or X
// (docs/modules/school-website.md, "Search"): 1200×630, in the school's
// accent, with its logo, name, motto and town. Drawn on request and cached
// for a day; nothing about any pupil.

export const dynamic = "force-dynamic";

const EMERALD = WEBSITE_ACCENTS.emerald.hex;

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const school = await loadSchool((await params).code).catch(() => null);
  const name = school?.name ?? "SchoolKit";
  const accent = school?.website.accent ?? EMERALD;
  const motto = school?.motto ?? null;
  const line = [school?.seo.town, school?.seo.levels.length ? school.seo.levels.join(" · ") : null].filter(Boolean).join("  ·  ");
  const logo = school?.logoUrl ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          gap: 30,
          background: accent,
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- rendered by ImageResponse, not the browser
            <img src={logo} width={128} height={128} alt="" style={{ borderRadius: 28, objectFit: "contain", background: "#fff", padding: 10 }} />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: name.length > 34 ? 58 : 74, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{name}</div>
            {line ? <div style={{ fontSize: 30, opacity: 0.85 }}>{line}</div> : null}
          </div>
        </div>
        {motto ? (
          <div style={{ display: "flex" }}>
            <div style={{ fontSize: 40, fontWeight: 700, color: "#13262e", background: "#fbd877", padding: "6px 20px", borderRadius: 12 }}>{motto}</div>
          </div>
        ) : null}
        {school?.admissionsOpen ? (
          <div style={{ display: "flex" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: accent, background: "#fff", padding: "12px 28px", borderRadius: 14 }}>Admissions open</div>
          </div>
        ) : null}
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
