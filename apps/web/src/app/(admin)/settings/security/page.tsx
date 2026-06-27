import { SecuritySettings } from "@/components/auth/security-settings";

// Owner-only. The API enforces auth.2fa.manage (owner only) on every endpoint
// this page calls, so an admin who navigates here directly will get 403s.
// The sidebar will only surface this link to users with the owner role.
export default function SecurityPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">
          Manage two-factor authentication for your account.
        </p>
      </header>
      <SecuritySettings />
    </div>
  );
}
