"use client";

import { Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { revealNavItem } from "@/components/admin/nav-list";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";
import { completeTourRequest } from "@/lib/tour/tour-api";
import { placeTourCard, type TourPointer } from "@/lib/tour/tour-placement";

// The first-login product tour for the owner/admin shell. Scope (plan-first,
// 2026-08-01): a single-page, sidebar-anchored ORIENTATION tour — "here's
// where things live" — not a page-navigating replica of the onboarding
// guide's 13-stage setup sequence (docs/onboarding-guide.md already covers
// the how-to in depth; this covers the map). A welcome card, the school's own
// name at the head of the menu, one spotlight per main admin area, then a
// closing card (buildTourSteps below).
//
// Auto-triggers once per account (User.tourCompletedAt gates it) for any
// owner/admin whose school has finished onboarding. Replayable afterwards
// via useTour().startReplay() (see Settings → School's "Replay tour" link)
// without touching the persisted completion flag.

type TourStep =
  | { kind: "intro" | "outro"; title: string; body: string }
  | { kind: "spot"; target: string; title: string; body: string };

// The stops, rewritten 2026-10-11 for the shell as it now stands: the school's
// own name and logo at the head of the menu (docs/modules/school-identity.md),
// the results and exam tools added since September, announcements, and the
// setup progress beside the greeting. A stop whose menu item this person
// cannot see (a permission they lack) still shows its card, centred, so the
// tour reads the same for every owner and admin.
export const TOUR_SCHOOL_TARGET = "school-brand";

export function buildTourSteps(schoolName: string | null | undefined): TourStep[] {
  const school = schoolName?.trim() || "your school";
  return [
    {
      kind: "intro",
      title: "Welcome to SchoolKit",
      body: `This is ${school}'s home on SchoolKit. A quick tour of where things live — about a minute. Skip anytime.`,
    },
    {
      kind: "spot",
      target: TOUR_SCHOOL_TARGET,
      title: "Your school",
      body: "Your school's name and logo head the menu here, on the parent portal and in the app. Add or change the logo in Settings → School.",
    },
    {
      kind: "spot",
      target: "/students",
      title: "Students",
      body: "Add students one at a time, in bulk, or import a whole class list from a spreadsheet. Parents are linked to each child here or under Parents & guardians.",
    },
    {
      kind: "spot",
      target: "/enrollments",
      title: "Class enrolment",
      body: "Put students in their classes for the term — one at a time or a whole class at once. Registers, fees and report cards all follow from this.",
    },
    {
      kind: "spot",
      target: "/staff",
      title: "Staff",
      body: "Invite teachers and admins, make form teachers, and assign who teaches which subject.",
    },
    {
      kind: "spot",
      target: "/settings/academic",
      title: "Sessions & classes",
      body: "Your session and terms, class levels, arms and subjects, and which classes take which subjects.",
    },
    {
      kind: "spot",
      target: "/report-cards",
      title: "Report cards",
      body: "Teachers enter scores in the Gradebook; you review, approve and release report cards from here.",
    },
    {
      kind: "spot",
      target: "/report-cards/pins",
      title: "Result checker",
      body: "Let parents check results online — free for everyone, or behind PIN cards you print and hand out.",
    },
    {
      kind: "spot",
      target: "/teacher/question-bank",
      title: "Questions and exams",
      body: "A question bank for each subject (AI can draft, a teacher approves), exam papers in versions A to D, and online exams on your lab computers.",
    },
    {
      kind: "spot",
      target: "/finance/dashboard",
      title: "Bursary",
      body: "Your fee list, invoices and payments, including fees parents pay online through Paystack.",
    },
    {
      kind: "spot",
      target: "/announcements",
      title: "Announcements",
      body: "Send news to parents — it reaches them in the app, on the parent portal and by email.",
    },
    {
      kind: "spot",
      target: "/settings",
      title: "Settings",
      body: "Your school profile and logo, notifications and your own SMS sender name, and who can sign in.",
    },
    {
      kind: "outro",
      title: "You're all set",
      body: "The ring beside your greeting shows how much of setup is done and what to do next. Replay this tour anytime from Settings → School.",
    },
  ];
}

interface TourContextValue {
  active: boolean;
  skip: () => void;
  startReplay: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour() must be used inside <TourProvider>");
  return ctx;
}

function useIsMobile(): boolean {
  // Matches Tailwind's default `md` breakpoint (768px), the same threshold
  // AdminSidebar/MobileNav already split on (`hidden md:flex` / `md:hidden`).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export function TourProvider({
  mobileNavOpen,
  setMobileNavOpen,
  children,
}: {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const { user, roles, school, setUser } = useAuth();
  const isMobile = useIsMobile();

  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const autoTriggeredRef = useRef(false);

  const isOwnerOrAdmin = roles.some((r) => r.key === "owner" || r.key === "admin");
  const shouldAutoShow =
    Boolean(user) && user?.tourCompletedAt == null && school?.status === "ACTIVE" && isOwnerOrAdmin;

  useEffect(() => {
    if (autoTriggeredRef.current || !shouldAutoShow) return;
    autoTriggeredRef.current = true;
    setStepIndex(0);
    setVisible(true);
  }, [shouldAutoShow]);

  // stepIndex is always kept in [0, steps.length - 1] by next()/back(), so
  // the fallback never actually triggers — the `!` just satisfies
  // noUncheckedIndexedAccess on a literal, non-empty, known-length array.
  const steps = useMemo(() => buildTourSteps(school?.name), [school?.name]);
  const step = steps[stepIndex] ?? steps[0]!;
  const targetHref = step.kind === "spot" ? step.target : null;

  // Mobile: the sidebar doesn't exist below `md`, so a spotlight step needs
  // the drawer forced open first — its own backdrop is reused as-is (see
  // TourOverlay below), the tour draws no second dimming layer on mobile.
  useEffect(() => {
    if (!visible || !isMobile) return;
    setMobileNavOpen(Boolean(targetHref));
  }, [visible, isMobile, targetHref, setMobileNavOpen]);

  // Measure the target's on-screen rect. Re-runs on resize/scroll (kept in
  // sync while visible) and on mobileNavOpen flipping true (the drawer's
  // portal mounts asynchronously after the effect above requests it open —
  // rAF alone isn't guaranteed to land after that mount, so re-measuring
  // when mobileNavOpen itself changes closes that race).
  //
  // Each stop first scrolls its item into view: the menu is a scrolling column
  // of ~20 items now, so Finance, Announcements and Settings sit below the
  // fold on a laptop and in the lower half of the phone drawer. Centring the
  // item leaves room above or below it for the card (tour-placement.ts).
  // Once per stop, so it never fights someone scrolling the menu themselves.
  // The menu folds into sections (nav-groups.ts), so a stop's item may sit in
  // a closed one: ask the menu to open it. A layout effect, so the section
  // opens in the same frame, before the measuring below looks for the item.
  useLayoutEffect(() => {
    if (visible && targetHref) revealNavItem(targetHref);
  }, [visible, targetHref, mobileNavOpen]);

  const scrolledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visible || !targetHref) {
      scrolledForRef.current = null;
      setRect(null);
      return;
    }
    function findTarget(): HTMLElement | undefined {
      // NavLink renders in BOTH AdminSidebar (desktop `<aside>`, `hidden
      // md:flex`) and MobileNav's drawer — the same data-tour-target value
      // exists twice in the DOM at once, one of them display:none. A plain
      // querySelector always returns the FIRST match regardless of
      // visibility (the desktop one, since AdminSidebar renders before
      // AdminTopbar/MobileNav) — on mobile that's the hidden copy, whose
      // getBoundingClientRect() is a real-but-all-zero DOMRect (not null,
      // so the `!rect` guard elsewhere never catches it), producing an
      // invisible zero-size spotlight instead of the real one in the open
      // drawer. Pick the first match that's actually rendered instead.
      const candidates = document.querySelectorAll<HTMLElement>(
        `[data-tour-target="${CSS.escape(targetHref as string)}"]`,
      );
      return Array.from(candidates).find(
        (c) => c.offsetWidth > 0 || c.offsetHeight > 0 || c.getClientRects().length > 0,
      );
    }
    function measure() {
      const el = findTarget();
      setRect(el ? el.getBoundingClientRect() : null);
    }
    function locate() {
      const el = findTarget();
      const stopKey = `${targetHref}|${mobileNavOpen}`;
      if (el && scrolledForRef.current !== stopKey) {
        scrolledForRef.current = stopKey;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      }
      measure();
    }
    const raf = requestAnimationFrame(locate);
    const retry = window.setTimeout(locate, 150);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(retry);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, targetHref, mobileNavOpen]);

  const dismiss = useCallback(() => {
    setVisible(false);
    setMobileNavOpen(false);
    setDismissing(true);
    completeTourRequest()
      .then(setUser)
      // Non-fatal: worst case the tour re-offers itself next login. Not
      // worth a user-facing error for a UX nicety.
      .catch(() => undefined)
      .finally(() => setDismissing(false));
  }, [setMobileNavOpen, setUser]);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= steps.length - 1) {
        dismiss();
        return i;
      }
      return i + 1;
    });
  }, [dismiss, steps.length]);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const startReplay = useCallback(() => {
    setStepIndex(0);
    setVisible(true);
  }, []);

  // Escape: on desktop the tour owns dismissal directly (no drawer in the
  // way). On mobile, MobileNav's own Escape listener already routes through
  // onMobileNavOpenChange -> dismiss() (see (admin)/layout.tsx), so this
  // listener is desktop-only to avoid a harmless-but-redundant double call.
  useEffect(() => {
    if (!visible || isMobile) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, isMobile, dismiss]);

  return (
    <TourContext.Provider value={{ active: visible, skip: dismiss, startReplay }}>
      {children}
      {visible &&
        typeof document !== "undefined" &&
        createPortal(
          <TourOverlay
            step={step}
            stepIndex={stepIndex}
            totalSteps={steps.length}
            rect={rect}
            isMobile={isMobile}
            busy={dismissing}
            onNext={next}
            onBack={back}
            onDismiss={dismiss}
          />,
          document.body,
        )}
    </TourContext.Provider>
  );
}

function TourOverlay({
  step,
  stepIndex,
  totalSteps,
  rect,
  isMobile,
  busy,
  onNext,
  onBack,
  onDismiss,
}: {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  rect: DOMRect | null;
  isMobile: boolean;
  busy: boolean;
  onNext: () => void;
  onBack: () => void;
  onDismiss: () => void;
}) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const isSpot = step.kind === "spot";

  const controls = (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="text-xs text-muted-foreground">
        Step {stepIndex + 1} of {totalSteps}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
          Skip tour
        </Button>
        {!isFirst && (
          <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
        <Button type="button" size="sm" onClick={onNext} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isLast ? "Finish" : "Next"}
        </Button>
      </div>
    </div>
  );

  const card = (
    <div className="flex flex-col gap-2">
      <h2 className="font-serif text-lg font-medium text-foreground">{step.title}</h2>
      <p className="text-sm text-muted-foreground">{step.body}</p>
      {controls}
    </div>
  );

  // Intro/outro — no target, same centered card on any viewport.
  if (!isSpot) {
    return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
        onClick={onDismiss}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-label={step.title}
          onClick={(e) => e.stopPropagation()}
        >
          {card}
        </div>
      </div>
    );
  }

  // Spotlight step, target not measured yet — render the card centered as a
  // brief fallback rather than nothing (rare: only the first rAF tick, or
  // mobile mid-drawer-mount).
  if (!rect) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl">{card}</div>
      </div>
    );
  }

  // The card goes beside its item, never over it (lib/tour/tour-placement.ts),
  // with a pointer on the side facing the item, so it reads as "this one".
  const placedCard = (
    <PlacedTourCard rect={rect} isMobile={isMobile} title={step.title} target={step.target}>
      {card}
    </PlacedTourCard>
  );

  if (isMobile) {
    // The drawer (MobileNav) already supplies its own backdrop — no second
    // dim layer here, just a highlight ring around the real target (inert:
    // pointer-events stay blocked so the tour can't be interrupted by
    // navigating mid-step) and the card above or below the item.
    return (
      <>
        <div
          className="pointer-events-auto fixed z-[65] rounded-md ring-2 ring-primary ring-offset-2 ring-offset-card"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
        {placedCard}
      </>
    );
  }

  // Desktop: full-page dim with a spotlight cutout around `rect` (the
  // classic box-shadow technique — one element sized exactly to the target
  // with an oversized shadow standing in for "everything else"), and the card
  // to the right of the menu, level with the item.
  return (
    <div className="fixed inset-0 z-[60]" onClick={onDismiss}>
      <div
        className="pointer-events-none fixed rounded-md"
        style={{
          top: rect.top - 4,
          left: rect.left - 4,
          width: rect.width + 8,
          height: rect.height + 8,
          boxShadow: "0 0 0 4000px rgba(15, 23, 42, 0.55)",
          outline: "2px solid hsl(var(--primary))",
          outlineOffset: "2px",
        }}
        aria-hidden="true"
      />
      {/* Inert click-blocker exactly over the target — keeps the tour
          deterministic (can't tab away mid-step by clicking through the
          spotlight cutout). */}
      <div
        className="fixed"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        onClick={(e) => e.stopPropagation()}
      />
      {placedCard}
    </div>
  );
}

// Measures its own height (the text differs per stop), then asks
// placeTourCard where to sit. The first paint uses an estimate and is hidden,
// so the card never flashes in the wrong place.
function PlacedTourCard({
  rect,
  isMobile,
  title,
  target,
  children,
}: {
  rect: DOMRect;
  isMobile: boolean;
  title: string;
  /** The stop's target, on the card for e2e/tests/first-login-tour.spec.ts. */
  target: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placement = placeTourCard({
    target: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    card: { height: height ?? 200 },
    isMobile,
  });
  const style: CSSProperties = {
    top: placement.top,
    left: placement.left,
    width: placement.width,
    visibility: height === null ? "hidden" : "visible",
  };

  return (
    <div
      ref={ref}
      className="fixed z-[70] rounded-lg border border-border bg-card p-4 shadow-xl"
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-tour-for={target}
      onClick={(e) => e.stopPropagation()}
    >
      <TourPointerMark pointer={placement.pointer} />
      {children}
    </div>
  );
}

// A small diamond on the card's edge, pointing at the item: the card's own
// background and border, half of it outside the card. Not a side stripe
// (CLAUDE.md, "No accent borders").
function TourPointerMark({ pointer }: { pointer: TourPointer }) {
  const size = 12;
  const position: CSSProperties =
    pointer.side === "left"
      ? { left: -size / 2 - 1, top: pointer.offset - size / 2 }
      : pointer.side === "top"
        ? { top: -size / 2 - 1, left: pointer.offset - size / 2 }
        : { bottom: -size / 2 - 1, left: pointer.offset - size / 2 };
  const edges =
    pointer.side === "left" ? "border-b border-l" : pointer.side === "top" ? "border-l border-t" : "border-b border-r";
  return (
    <span
      className={`pointer-events-none absolute rotate-45 bg-card border-border ${edges}`}
      style={{ ...position, width: size, height: size }}
      aria-hidden="true"
    />
  );
}
