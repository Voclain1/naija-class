"use client";

import { Loader2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";
import { completeTourRequest } from "@/lib/tour/tour-api";

// The first-login product tour for the owner/admin shell. Scope (plan-first,
// 2026-08-01): a single-page, sidebar-anchored ORIENTATION tour — "here's
// where things live" — not a page-navigating replica of the onboarding
// guide's 13-stage setup sequence (docs/onboarding-guide.md already covers
// the how-to in depth; this covers the map). Nine stops: a welcome card,
// then one spotlight per top-level admin nav item, then a closing card.
//
// Auto-triggers once per account (User.tourCompletedAt gates it) for any
// owner/admin whose school has finished onboarding. Replayable afterwards
// via useTour().startReplay() (see Settings → School's "Replay tour" link)
// without touching the persisted completion flag.

type TourStep =
  | { kind: "intro" | "outro"; title: string; body: string }
  | { kind: "spot"; target: string; title: string; body: string };

const STEPS: TourStep[] = [
  {
    kind: "intro",
    title: "Welcome to SchoolKit",
    body: "Quick tour of where things live — about a minute. Skip anytime.",
  },
  {
    kind: "spot",
    target: "/students",
    title: "Students",
    body: "Add students one at a time, in bulk, or import a whole roster from a CSV.",
  },
  {
    kind: "spot",
    target: "/enrollments",
    title: "Enrollments",
    body: "Once class arms exist, enrol students into them here — individually or in bulk.",
  },
  {
    kind: "spot",
    target: "/staff",
    title: "Staff",
    body: "Invite teachers and admins, and assign who teaches what.",
  },
  {
    kind: "spot",
    target: "/settings/academic",
    title: "Academics",
    body: "Your academic year, terms, class levels, arms, subjects, and which classes take which subjects.",
  },
  {
    kind: "spot",
    target: "/settings/grading",
    title: "Grading",
    body: "How scores become letter grades — your grading scheme and grade boundaries.",
  },
  {
    kind: "spot",
    target: "/report-cards",
    title: "Report Cards",
    body: "Once scores are entered, build, review, and release report cards from here.",
  },
  {
    kind: "spot",
    target: "/finance/dashboard",
    title: "Finance",
    body: "Your fee catalog, invoices, and payments all live here.",
  },
  {
    kind: "spot",
    target: "/settings",
    title: "Settings",
    body: "Your school profile, logo, and user management — plus this tour, if you want it again.",
  },
  {
    kind: "outro",
    title: "You're all set",
    body: "That's the map — the rest is filling it in. Replay this anytime from Settings → School.",
  },
];

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

  // stepIndex is always kept in [0, STEPS.length - 1] by next()/back(), so
  // the fallback never actually triggers — the `!` just satisfies
  // noUncheckedIndexedAccess on a literal, non-empty, known-length array.
  const step = STEPS[stepIndex] ?? STEPS[0]!;
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
  useEffect(() => {
    if (!visible || !targetHref) {
      setRect(null);
      return;
    }
    function measure() {
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
      const el = Array.from(candidates).find(
        (c) => c.offsetWidth > 0 || c.offsetHeight > 0 || c.getClientRects().length > 0,
      );
      setRect(el ? el.getBoundingClientRect() : null);
    }
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
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
      if (i >= STEPS.length - 1) {
        dismiss();
        return i;
      }
      return i + 1;
    });
  }, [dismiss]);

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
            totalSteps={STEPS.length}
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

  if (isMobile) {
    // The drawer (MobileNav) already supplies its own backdrop — no second
    // dim layer here, just a highlight ring around the real target (inert:
    // pointer-events stay blocked so the tour can't be interrupted by
    // navigating mid-step) and a fixed bottom sheet, since there's no room
    // to float a tooltip beside an item inside an 85vw-wide drawer.
    return (
      <>
        <div
          className="pointer-events-auto fixed z-[65] rounded-md ring-2 ring-primary ring-offset-2 ring-offset-card"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          aria-hidden="true"
        />
        <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-card p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]">
          {card}
        </div>
      </>
    );
  }

  // Desktop: full-page dim with a spotlight cutout around `rect` (the
  // classic box-shadow technique — one element sized exactly to the target
  // with an oversized shadow standing in for "everything else"), plus a
  // floating tooltip clamped to the viewport, preferring the target's right
  // side and falling back below it when there isn't room.
  const margin = 12;
  const tooltipWidth = 320;
  const preferRight = rect.right + margin + tooltipWidth <= window.innerWidth;
  const tooltipStyle: CSSProperties = preferRight
    ? { top: Math.max(margin, rect.top), left: rect.right + margin }
    : {
        top: Math.min(rect.bottom + margin, window.innerHeight - 220),
        left: Math.min(Math.max(rect.left, margin), window.innerWidth - tooltipWidth - margin),
      };

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
      <div
        className="fixed w-80 rounded-lg border border-border bg-card p-4 shadow-xl"
        style={tooltipStyle}
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
