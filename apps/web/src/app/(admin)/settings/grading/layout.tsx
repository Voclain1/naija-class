// Sub-nav shell for /settings/grading/* (Scheme + Boundaries). Mirrors the
// /settings/academic layout.

import { GradingSubNav } from "@/components/settings/grading/sub-nav";

export default function GradingSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <GradingSubNav />
      <div>{children}</div>
    </div>
  );
}
