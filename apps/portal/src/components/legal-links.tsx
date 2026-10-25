import { LEGAL_URLS } from "@school-kit/types";

// SchoolKit's legal pages (docs/modules/data-protection.md), as one quiet
// line for the foot of sign-in and settings pages. New tab, so a half-filled
// form is not lost.
export function LegalLinks({ className }: { className?: string }) {
  const links: [string, string][] = [
    [LEGAL_URLS.privacy, "Privacy"],
    [LEGAL_URLS.terms, "Terms"],
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
