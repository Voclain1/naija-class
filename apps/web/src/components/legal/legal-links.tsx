import { LEGAL_URLS } from "@school-kit/types";

// Links to SchoolKit's legal pages (docs/modules/data-protection.md), opened
// in a new tab so a half-filled form is not lost.

export function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2">
      {children}
    </a>
  );
}

/** One quiet line of links, for the foot of sign-in pages and settings. */
export function LegalLinks({ className }: { className?: string }) {
  const links: [string, string][] = [
    [LEGAL_URLS.privacy, "Privacy"],
    [LEGAL_URLS.terms, "Terms"],
    [LEGAL_URLS.dataProcessing, "Data processing"],
    [LEGAL_URLS.deleteAccount, "Delete your account"],
  ];
  return (
    <p className={`flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground ${className ?? ""}`}>
      {links.map(([href, label]) => (
        <a key={href} href={href} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
          {label}
        </a>
      ))}
    </p>
  );
}

/** The school owner's confirmation, as one sentence with its links. */
export function SchoolConsentText() {
  return (
    <span>
      I am authorised to set up SchoolKit for this school. The school will get each parent&apos;s or guardian&apos;s
      consent before putting a child&apos;s details into SchoolKit (and explicit consent before recording health
      information), and will tell parents and staff that it uses SchoolKit. I accept the{" "}
      <LegalLink href={LEGAL_URLS.terms}>Terms of Service</LegalLink> and the{" "}
      <LegalLink href={LEGAL_URLS.dataProcessing}>Data Processing Agreement</LegalLink>, and I have read the{" "}
      <LegalLink href={LEGAL_URLS.privacy}>Privacy Policy</LegalLink>.
    </span>
  );
}
