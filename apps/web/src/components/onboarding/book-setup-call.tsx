"use client";

import { CalendarCheck, Check, Clock, Loader2, Mail, MessageCircle, Phone, Users, GraduationCap, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  SCHOOLKIT_SUPPORT,
  formatCallSlot,
  formatCallTime,
  onboardingCallDays,
  onboardingCallStarts,
  onboardingCallWhatsappText,
  onboardingCallWhatsappUrl,
  type OnboardingCallBookingDto,
  type OnboardingCallStateDto,
} from "@school-kit/types";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";

// The page a new school sees once, after the setup wizard (docs/modules/
// onboarding-call.md): book a free setup call with the SchoolKit team, or skip.
// Booking or skipping closes it for good; anyone it is not for goes straight
// to the dashboard.

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayParts(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return { weekday: WEEKDAY[d.getUTCDay()]!, day: d.getUTCDate(), month: MONTH[d.getUTCMonth()]! };
}

const HELPS = [
  { icon: LayoutGrid, text: "Classes, terms and fees" },
  { icon: Users, text: "Staff and their logins" },
  { icon: GraduationCap, text: "Students and parents" },
];

export function BookSetupCall() {
  const router = useRouter();
  const { school } = useAuth();
  const [state, setState] = useState<OnboardingCallStateDto | null>(null);
  const [booked, setBooked] = useState<OnboardingCallBookingDto | null>(null);

  const days = useMemo(() => onboardingCallDays(), []);
  const starts = useMemo(() => onboardingCallStarts(), []);
  const [date, setDate] = useState<string>(days[0] ?? "");
  const [startMinute, setStartMinute] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<"book" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OnboardingCallStateDto>("/schools/me/onboarding-call")
      .then((s) => {
        // ?book=1 (the checklist's link, a setup reminder) opens the page for
        // an owner or admin who has not booked yet, even after it has closed.
        const bookMode = new URLSearchParams(window.location.search).get("book") === "1";
        if (bookMode && s.booking) {
          // Already booked: show it again rather than a second form.
          setState(s);
          setBooked(s.booking);
          return;
        }
        if (!s.show && !(bookMode && s.canBook)) {
          router.replace("/dashboard");
          return;
        }
        setState(s);
        setName(s.suggestedName);
        setPhone(s.suggestedPhone);
      })
      .catch(() => router.replace("/dashboard"));
  }, [router]);

  async function skip() {
    setBusy("skip");
    try {
      await apiFetch("/schools/me/onboarding-call/skip", { method: "POST" });
    } catch {
      // Skipping must never trap anyone on this page.
    }
    router.replace("/dashboard");
  }

  async function book(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (startMinute === null) {
      setError("Choose a time.");
      return;
    }
    setBusy("book");
    try {
      const b = await apiFetch<OnboardingCallBookingDto>("/schools/me/onboarding-call", {
        method: "POST",
        body: { date, startMinute, contactName: name, contactPhone: phone, note: note.trim() || null },
      });
      setBooked(b);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not book the call. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  const schoolName = school?.name ?? "your school";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Soft colour behind the card: tints only, no lines. */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-secondary/15 blur-3xl" />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8">
        <SchoolKitWordmark iconSize={28} textClassName="text-xl" />
        {!booked && (
          <Button variant="ghost" size="sm" onClick={skip} disabled={busy !== null} data-testid="setup-call-skip-top">
            Skip for now
          </Button>
        )}
      </header>

      <main className="relative z-10 flex min-w-0 flex-1 items-center justify-center px-4 pb-10 sm:px-8">
        {state === null ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : booked ? (
          <Booked booking={booked} schoolName={schoolName} onDone={() => router.replace("/dashboard")} />
        ) : (
          <div className="grid w-full min-w-0 max-w-5xl grid-cols-1 overflow-hidden rounded-3xl bg-card shadow-xl ring-1 ring-border/60 md:grid-cols-[2fr_3fr]">
            <section className="flex min-w-0 flex-col justify-between gap-8 bg-primary px-6 py-8 text-primary-foreground sm:px-10 sm:py-12">
              <div className="flex flex-col gap-4">
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-primary-foreground/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                  <CalendarCheck className="h-3.5 w-3.5" /> Free setup call
                </span>
                <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Let&apos;s finish setting up {schoolName} together</h1>
                <p className="text-base text-primary-foreground/85">Pick a time and our team will walk you through it on a 30-minute call.</p>
              </div>
              <ul className="flex flex-col gap-3">
                {HELPS.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-sm">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
                      <Icon className="h-4 w-4" />
                    </span>
                    {text}
                  </li>
                ))}
              </ul>
            </section>

            <form onSubmit={book} className="flex min-w-0 flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-3 text-sm font-semibold">Choose a day</legend>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {days.map((d) => {
                    const p = dayParts(d);
                    const active = d === date;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDate(d)}
                        aria-pressed={active}
                        aria-label={formatCallSlot(d, 0).replace(/ at .*/, "")}
                        className={cn(
                          "flex min-w-0 flex-col items-center rounded-2xl py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "bg-primary text-primary-foreground shadow" : "bg-muted/60 hover:bg-muted",
                        )}
                      >
                        <span className={cn("text-[11px] uppercase", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{p.weekday}</span>
                        <span className="text-lg font-semibold leading-tight tabular-nums">{p.day}</span>
                        <span className={cn("text-[11px]", active ? "text-primary-foreground/80" : "text-muted-foreground")}>{p.month}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Clock className="h-4 w-4 text-muted-foreground" /> Choose a time <span className="font-normal text-muted-foreground">(Lagos time)</span>
                </legend>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {starts.map((m) => {
                    const active = m === startMinute;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setStartMinute(m)}
                        aria-pressed={active}
                        className={cn(
                          "min-w-0 whitespace-nowrap rounded-full py-2 text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "bg-primary font-semibold text-primary-foreground shadow" : "bg-muted/60 hover:bg-muted",
                        )}
                      >
                        {formatCallTime(m)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="call-name">Your name</Label>
                  <Input id="call-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="call-phone">Phone or WhatsApp</Label>
                  <Input id="call-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
                </div>
              </div>

              {showNote ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="call-note">Anything we should know?</Label>
                  <textarea
                    id="call-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    rows={3}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setShowNote(true)} className="w-fit text-sm text-primary underline-offset-4 hover:underline">
                  + Add a note
                </button>
              )}

              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

              <div className="flex flex-col gap-3">
                <Button type="submit" size="lg" className="w-full rounded-full text-base" disabled={busy !== null} data-testid="setup-call-book">
                  {busy === "book" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {startMinute === null ? "Book my call" : `Book ${dayParts(date).weekday} ${dayParts(date).day} ${dayParts(date).month}, ${formatCallTime(startMinute)}`}
                </Button>
                <button type="button" onClick={skip} disabled={busy !== null} className="text-sm text-muted-foreground underline-offset-4 hover:underline" data-testid="setup-call-skip">
                  Skip for now, I&apos;ll set up on my own
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      <ContactFooter />
    </div>
  );
}

function Booked({ booking, schoolName, onDone }: { booking: OnboardingCallBookingDto; schoolName: string; onDone: () => void }) {
  const whatsapp = onboardingCallWhatsappUrl(onboardingCallWhatsappText(schoolName, booking));
  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl bg-card px-6 py-10 text-center shadow-xl ring-1 ring-border/60 sm:px-10" data-testid="setup-call-booked">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-8 w-8" strokeWidth={2.5} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">You&apos;re booked</h1>
        <p className="text-lg font-medium text-primary">{formatCallSlot(booking.date, booking.startMinute)}</p>
        <p className="text-sm text-muted-foreground">Lagos time. We&apos;ll message you on WhatsApp to confirm.</p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <Button asChild size="lg" className="w-full rounded-full">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> Send to SchoolKit on WhatsApp
          </a>
        </Button>
        <Button variant="outline" size="lg" className="w-full rounded-full" onClick={onDone} data-testid="setup-call-dashboard">
          Go to my dashboard
        </Button>
      </div>
    </div>
  );
}

function ContactFooter() {
  const items = [
    { icon: Mail, label: SCHOOLKIT_SUPPORT.email, href: `mailto:${SCHOOLKIT_SUPPORT.email}` },
    { icon: Phone, label: SCHOOLKIT_SUPPORT.phoneDisplay, href: `tel:+${SCHOOLKIT_SUPPORT.phoneDigits}` },
    { icon: MessageCircle, label: "WhatsApp", href: `https://wa.me/${SCHOOLKIT_SUPPORT.phoneDigits}` },
  ];
  return (
    <footer className="relative z-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 pb-6 text-sm text-muted-foreground">
      {items.map(({ icon: Icon, label, href }) => (
        <a key={href} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-foreground">
          <Icon className="h-4 w-4" /> {label}
        </a>
      ))}
    </footer>
  );
}
