"use client";

import { MessagesSquare, Award, BarChart3, Inbox, Bell, Building2, CalendarCheck, CalendarClock, CreditCard, FileText, Gauge, Hash, Layers, Percent, ShieldCheck, SlidersHorizontal, Sparkles, User, Users, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-primitives";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";

// /settings — a small hub linking the settings areas. (Previously a bare
// redirect to /settings/users; grew a card per area as they landed —
// Attendance is the Phase 2 / Slice 8 opt-in toggle.)
interface SettingsLink {
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
  // Shown only to someone holding this permission (2026-10-19). The Security
  // card was shown to every admin, but two-factor is the owner's alone
  // (auth.2fa.manage), so an admin who opened it met errors.
  requiredPermission?: string;
}

const LINKS: SettingsLink[] = [
  {
    label: "School details",
    href: "/settings/school",
    description: "Name, contact info, and logo shown across the app.",
    icon: Building2,
  },
  {
    label: "Admission numbers",
    href: "/settings/admission-numbers",
    description: "Your format, and whether SchoolKit gives each new student the next number.",
    icon: Hash,
  },
  {
    label: "Admissions",
    href: "/settings/admissions",
    description: "Your online application form, the classes open, and who hears about each new application.",
    icon: Inbox,
  },
  {
    label: "Messaging",
    href: "/settings/messaging",
    description: "Appoint the principal, head teacher and Inbox officers parents can write to.",
    icon: MessagesSquare,
  },
  { label: "Users", href: "/settings/users", description: "Staff accounts, roles, and invitations.", icon: Users },
  { label: "Academics", href: "/settings/academic", description: "Years, terms, levels, arms, and subjects.", icon: BarChart3 },
  { label: "Grading", href: "/settings/grading", description: "Component weights and grade boundaries.", icon: SlidersHorizontal },
  // These two live under Finance now (2026-08-14) — the cards stay here
  // because admins have looked for them in Settings since Phase 3, they just
  // link across. The old /settings/finance/{fees,discounts} URLs redirect.
  {
    label: "Fee catalog",
    href: "/finance/fees",
    description: "Fee categories and items, with optional class/term scope.",
    icon: Wallet,
  },
  {
    label: "Discounts",
    href: "/finance/discounts",
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
    label: "Bell schedule",
    href: "/settings/bell-schedule",
    description: "The periods of the school day and the days your school meets.",
    icon: CalendarClock,
  },
  {
    label: "Attendance",
    href: "/settings/attendance",
    description: "Subject-period attendance, and when a student counts as often absent.",
    icon: CalendarCheck,
  },
  {
    label: "Behaviour",
    href: "/settings/behaviour",
    description: "Behaviour points, and the categories teachers choose from.",
    icon: Award,
  },
  {
    label: "Report cards",
    href: "/settings/report-cards",
    description: "Whether class position appears on printed cards and to families.",
    icon: FileText,
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
    label: "AI marking drafts",
    href: "/settings/ai-marking",
    description: "Let teachers ask AI for a first draft of marks and feedback. Off until you switch it on.",
    icon: Sparkles,
  },
  {
    label: "Plan",
    href: "/settings/plan",
    description: "Your plan and how many students it covers.",
    icon: Layers,
  },
  {
    label: "AI usage",
    href: "/settings/ai-usage",
    description: "What the AI features have used this month, and what's left.",
    icon: Gauge,
  },
  {
    label: "Security",
    href: "/settings/security",
    description: "Two-factor authentication for your owner account.",
    icon: ShieldCheck,
    requiredPermission: "auth.2fa.manage",
  },
  {
    label: "My profile",
    href: "/settings/profile",
    description: "Bank Verification Number and payroll details.",
    icon: User,
  },
];

export default function SettingsIndex() {
  const { permissions } = useAuth();
  const links = LINKS.filter((l) => !l.requiredPermission || hasPermission(permissions, l.requiredPermission));
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* This page had NO page header at all — a bare `text-2xl font-semibold`
          in the browser's default sans, on a page a head teacher visits to
          change the things that matter most. It is where the Students
          screenshot run stopped, because there was no <h1> to wait for. */}
      <PageHeader title="Settings" subtitle="Manage your school's configuration." />

      <ul className="grid gap-4 sm:grid-cols-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors motion-reduce:transition-none hover:bg-accent/40"
              >
                <Icon className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 p-2 text-primary" />
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
