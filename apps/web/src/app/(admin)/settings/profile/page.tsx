import { BvnSection } from "@/components/staff/bvn-section";

// /settings/profile — Phase 3 / Slice 12. Self-service surface for
// account-level payroll data. Currently just BVN; the natural home for any
// future "about me" fields.
export default function ProfileSettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          Manage payroll-related information tied to your own account.
        </p>
      </header>
      <BvnSection mode="self" />
    </div>
  );
}
