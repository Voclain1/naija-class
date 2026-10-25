// A drawn school building in the school's accent colour, for a front page
// with no cover photo yet (docs/modules/school-website.md, "The look"). A
// building and its grounds only, never people: the no-pupils rule (W4) is
// about photos, and a drawing has no reason to test it.

export function SchoolIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 360" className={className} role="img" aria-label="A drawing of a school building" preserveAspectRatio="xMidYMid slice">
      <rect width="480" height="360" fill="var(--sa-soft)" />
      {/* sun and clouds */}
      <circle cx="390" cy="74" r="30" fill="var(--sa-marker)" />
      <g fill="#fff">
        <ellipse cx="110" cy="70" rx="44" ry="16" />
        <ellipse cx="140" cy="60" rx="28" ry="16" />
        <ellipse cx="320" cy="110" rx="34" ry="12" />
      </g>
      {/* ground */}
      <path d="M0 290 Q 240 262 480 290 V360 H0z" fill="color-mix(in srgb, var(--sa) 22%, white)" />
      <path d="M210 360 Q 228 320 240 300 Q 252 320 270 360z" fill="#fff" opacity="0.8" />
      {/* side wings */}
      <rect x="70" y="180" width="120" height="110" rx="6" fill="#fff" />
      <rect x="290" y="180" width="120" height="110" rx="6" fill="#fff" />
      <path d="M62 184 L130 150 L198 184z" fill="var(--sa)" opacity="0.85" />
      <path d="M282 184 L350 150 L418 184z" fill="var(--sa)" opacity="0.85" />
      {/* main block */}
      <rect x="170" y="140" width="140" height="150" rx="6" fill="#fff" />
      <path d="M158 146 L240 92 L322 146z" fill="var(--sa)" />
      <circle cx="240" cy="124" r="12" fill="#fff" />
      <path d="M240 116 v8 l5 4" stroke="var(--sa)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* flag */}
      <path d="M240 92 V52" stroke="var(--sa-ink)" strokeWidth="3" strokeLinecap="round" />
      <path d="M241 54 h26 l-6 8 6 8 h-26z" fill="var(--sa-marker)" />
      {/* door */}
      <rect x="220" y="232" width="40" height="58" rx="20" fill="var(--sa)" />
      {/* windows */}
      <g fill="color-mix(in srgb, var(--sa) 28%, white)">
        <rect x="186" y="166" width="30" height="34" rx="4" />
        <rect x="264" y="166" width="30" height="34" rx="4" />
        <rect x="88" y="204" width="34" height="30" rx="4" />
        <rect x="138" y="204" width="34" height="30" rx="4" />
        <rect x="88" y="246" width="34" height="30" rx="4" />
        <rect x="138" y="246" width="34" height="30" rx="4" />
        <rect x="308" y="204" width="34" height="30" rx="4" />
        <rect x="358" y="204" width="34" height="30" rx="4" />
        <rect x="308" y="246" width="34" height="30" rx="4" />
        <rect x="358" y="246" width="34" height="30" rx="4" />
      </g>
      {/* trees */}
      <g>
        <rect x="32" y="250" width="6" height="40" fill="var(--sa-ink)" opacity="0.6" />
        <circle cx="35" cy="240" r="24" fill="var(--sa)" opacity="0.9" />
        <rect x="442" y="250" width="6" height="40" fill="var(--sa-ink)" opacity="0.6" />
        <circle cx="445" cy="236" r="28" fill="var(--sa)" opacity="0.75" />
      </g>
    </svg>
  );
}
