/* eslint-disable @next/next/no-img-element -- signed, short-lived image links */
import QRCode from "react-qr-code";

import type { IdCardSchoolDto, PrintableIdCardDto } from "@school-kit/types";

// One ID card at its real size, ISO/IEC 7810 ID-1 (85.6 × 54 mm), the size
// every PVC card printer takes (docs/modules/id-cards-and-store.md §3).
// Sized in millimetres so it prints true; on screen 1 mm is about 3.8 px.
//
// Front: the school's band (logo, name, motto) in its colour, the photo, name,
// class or role, number, session and the QR code. Back: where to return it,
// a signature line and the card number. Nothing else (owner's answer 2).

const FALLBACK_COLOUR = "#0E5C43"; // Deep Emerald, the brand primary

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const CARD_STYLE: React.CSSProperties = {
  width: "85.6mm",
  height: "54mm",
  boxSizing: "border-box",
  overflow: "hidden",
  borderRadius: "3mm",
  background: "#ffffff",
  color: "#13262E",
  printColorAdjust: "exact",
  WebkitPrintColorAdjust: "exact",
  fontFamily: "var(--font-sans), system-ui, sans-serif",
};

export function IdCardFront({ school, card }: { school: IdCardSchoolDto; card: PrintableIdCardDto }) {
  const colour = school.primaryColor || FALLBACK_COLOUR;
  return (
    <div style={CARD_STYLE} className="flex flex-col" data-testid="id-card-front">
      <div style={{ background: colour, color: "#ffffff", height: "12mm", padding: "0 3mm" }} className="flex items-center gap-[2mm]">
        {school.logoUrl ? (
          <img src={school.logoUrl} alt="" style={{ height: "9mm", width: "9mm", objectFit: "contain", background: "#fff", borderRadius: "1.5mm" }} />
        ) : null}
        <div className="min-w-0 leading-tight">
          <div style={{ fontSize: "3.4mm", fontWeight: 700 }} className="truncate">
            {school.name}
          </div>
          {school.motto ? (
            <div style={{ fontSize: "2.2mm", opacity: 0.9 }} className="truncate italic">
              {school.motto}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 gap-[2.5mm]" style={{ padding: "2.5mm 3mm" }}>
        {card.photoUrl ? (
          <img
            src={card.photoUrl}
            alt={`Photo of ${card.name}`}
            style={{ width: "21mm", height: "27mm", objectFit: "cover", borderRadius: "1mm", border: "0.2mm solid #cfd6d9" }}
          />
        ) : (
          <div
            style={{ width: "21mm", height: "27mm", borderRadius: "1mm", border: "0.2mm solid #cfd6d9", fontSize: "6mm", color: "#5B6B72" }}
            className="flex shrink-0 items-center justify-center bg-[#eef1f2]"
          >
            {initials(card.name)}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="flex flex-col gap-[0.6mm] leading-tight">
            <div style={{ fontSize: "2.2mm", letterSpacing: "0.3mm", color: colour, fontWeight: 700 }}>
              {card.kind === "STUDENT" ? "STUDENT" : "STAFF"}
            </div>
            <div style={{ fontSize: "3.6mm", fontWeight: 700 }} className="line-clamp-2">
              {card.name}
            </div>
            {card.detail ? <div style={{ fontSize: "2.6mm" }}>{card.detail}</div> : null}
            {card.number ? (
              <div style={{ fontSize: "2.4mm", color: "#5B6B72" }}>
                {card.kind === "STUDENT" ? "Adm. no." : "Staff no."} <span className="font-mono">{card.number}</span>
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: "2.3mm" }}>
            Valid for <span style={{ fontWeight: 700 }}>{card.validFor}</span> session
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center justify-end gap-[0.8mm]">
          <div style={{ width: "16mm", height: "16mm", background: "#fff" }}>
            <QRCode value={card.verifyUrl} size={256} style={{ width: "100%", height: "100%" }} level="M" />
          </div>
          <div style={{ fontSize: "1.8mm", color: "#5B6B72" }}>Scan to check</div>
        </div>
      </div>
    </div>
  );
}

export function IdCardBack({ school, card }: { school: IdCardSchoolDto; card: PrintableIdCardDto }) {
  const colour = school.primaryColor || FALLBACK_COLOUR;
  return (
    <div style={{ ...CARD_STYLE, padding: "4mm" }} className="flex flex-col justify-between" data-testid="id-card-back">
      <div className="flex flex-col gap-[1mm] leading-snug">
        <div style={{ fontSize: "2.6mm", fontWeight: 700, color: colour }}>If found, please return to</div>
        <div style={{ fontSize: "3.2mm", fontWeight: 700 }}>{school.name}</div>
        {school.address ? <div style={{ fontSize: "2.6mm" }}>{school.address}</div> : null}
        {school.phone ? <div style={{ fontSize: "2.6mm" }}>Tel: {school.phone}</div> : null}
        <div style={{ fontSize: "2.2mm", color: "#5B6B72" }}>
          This card remains the property of the school and must be shown on request.
        </div>
      </div>
      <div className="flex items-end justify-between gap-[3mm]">
        <div className="flex flex-col items-start">
          <div style={{ width: "34mm", borderTop: "0.25mm solid #13262E" }} />
          <div style={{ fontSize: "2.2mm", color: "#5B6B72" }}>Authorised signature</div>
        </div>
        <div className="text-right" style={{ fontSize: "2.3mm" }}>
          Card no. <span className="font-mono font-semibold">{card.cardNumber}</span>
        </div>
      </div>
    </div>
  );
}
