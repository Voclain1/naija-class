import { BarChart3, Bell, Building2, CalendarCheck, CreditCard, Percent, ShieldCheck, SlidersHorizontal, Sparkles, User, Users, Wallet, type LucideIcon } from "lucide-react";
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
  {
    label: "School details",
    href: "/settings/school",
    description: "Name, contact info, and logo shown across the app.",
    icon: Building2,
  },
  { label: "Users", href: "/settings/users", description: "Staff accounts, roles, and invitations.", icon: Users },
  { label: "Academics", href: "/settings/academic", description: "Years, terms, levels, arms, and subjects.", icon: BarChart3 },
  { label: "Grading", href: "/settings/grading", description: "Component weights and grade boundaries.", icon: SlidersHorizontal },
  {
    label: "Fee catalog",
    href: "/settings/finance/fees",
    description: "Fee categories and items, with optional class/term scope.",
    icon: Wallet,
  },
  {
    label: "Discounts",
    href: "/settings/finance/discounts",
    description: "Per-student discount rules applied to invoiced fees.",
    icon: Percent,
  },
  {
    label: "Payments",
    href: "/settings/finance/payments",
    description: "Connect your Paystack subaccount, or collect fees manually.",
    icon: CreditCard,
  },
  {
    label: "Attendance",
    href: "/settings/attendance",
    description: "Enable subject-period attendance for teachers.",
    icon: CalendarCheck,
  },
  {
    label: "Notifications",
    href: "/settings/notifications",
    description: "Email and SMS channels for guardian invitations and reminders.",
    icon: Bell,
  },
  {
    label: "Weekly parent updates",
    href: "/settings/parent-summaries",
    description: "AI-written weekly notes to parents. Off until you switch it on.",
    icon: Sparkles,
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
