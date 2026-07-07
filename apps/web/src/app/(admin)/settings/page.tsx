import { BarChart3, CalendarCheck, ShieldCheck, SlidersHorizontal, User, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";

// /settings — a small hub linking the settings areas. (Previously a bare
// redirect to /settings/users; grew a card per area as they landed —
// Attendance is the Phase 2 / Slice 8 opt-in toggle.)
interface SettingsLink {
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
}

const LINKS: SettingsLink[] = [
  { label: "Users", href: "/settings/users", description: "Staff accounts, roles, and invitations.", icon: Users },
  { label: "Academics", href: "/settings/academic", description: "Years, terms, levels, arms, and subjects.", icon: BarChart3 },
  { label: "Grading", href: "/settings/grading", description: "Component weights and grade boundaries.", icon: SlidersHorizontal },
  {
    label: "Attendance",
    href: "/settings/attendance",
    description: "Enable subject-period attendance for teachers.",
    icon: CalendarCheck,
  },
  {
    label: "Security",
    href: "/settings/security",
    description: "Two-factor authentication for your owner account.",
    icon: ShieldCheck,
  },
  {
    label: "My profile",
    href: "/settings/profile",
    description: "Bank Verification Number and payroll details.",
    icon: User,
  },
];

export default function SettingsIndex() {
  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your school&apos;s configuration.</p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        {LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex items-start gap-3 rounded-md border p-4 transition-colors hover:bg-accent/40"
              >
                <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{link.label}</span>
                  <span className="text-xs text-muted-foreground">{link.description}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
