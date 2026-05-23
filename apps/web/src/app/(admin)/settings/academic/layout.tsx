// Sub-nav for /settings/academic/*. Slice 2 introduces this layout because
// the section now has two distinct sub-pages (Years and Class Levels) that
// the user needs to switch between freely. Slice 3 will add Subjects and
// Class Arms tabs to the same nav.

import { AcademicSubNav } from "@/components/settings/academic/sub-nav";

export default function AcademicSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <AcademicSubNav />
      <div>{children}</div>
    </div>
  );
}
