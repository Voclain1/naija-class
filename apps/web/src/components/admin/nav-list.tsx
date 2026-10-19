"use client";

import { ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { activeHref, buildNavBlocks, matchesNavSearch, type NavGroupKey } from "./nav-groups";
import { LATER_PHASE_ITEMS, NAV_ITEMS, type NavItem } from "./nav-items";

// Shared between the desktop rail (sidebar.tsx) and the mobile drawer
// (mobile-nav.tsx) — one nav-rendering implementation, two containers.
//
// `items`/`laterPhaseItems` default to the admin nav (NAV_ITEMS/
// LATER_PHASE_ITEMS) so every existing admin call site (AdminSidebar,
// MobileNav via AdminTopbar) keeps rendering exactly as before with no
// props passed. The teacher portal passes its own list explicitly instead —
// see components/teacher/sidebar.tsx's useTeacherNavItems() and
// components/teacher/topbar.tsx. Previously this was hardcoded to the admin
// list unconditionally, so a teacher's mobile hamburger drawer showed
// admin's Students/Staff/Finance/Settings instead of their own nav (see
// docs/deferred.md "Teacher portal mobile nav shows admin items").
//
// Families (2026-10-19, nav-groups.ts): a long menu folds into sections that
// open and close. The section holding the current page is always open, the
// sections someone opened stay open on their next visit, and a search box
// finds any page by name or an everyday word ("fees", "parents"). A short
// menu stays a plain list.

const OPEN_GROUPS_KEY = "sk-nav-open-groups";

/** Fired by the first-login tour to open the section holding a page. */
export const NAV_REVEAL_EVENT = "schoolkit:nav-reveal";

// The last page the tour pointed at, for a menu that mounts after it asked
// (the phone drawer opens for each stop).
let lastRevealed: string | null = null;

/** Opens the menu section holding `href`, in every menu on screen and any about to open. */
export function revealNavItem(href: string) {
  lastRevealed = href;
  window.dispatchEvent(new CustomEvent(NAV_REVEAL_EVENT, { detail: href }));
}

function readOpenGroups(): NavGroupKey[] {
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((g): g is NavGroupKey => typeof g === "string") : [];
  } catch {
    return [];
  }
}

function writeOpenGroups(groups: NavGroupKey[]) {
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Private window or blocked storage: the menu still works, it just
    // forgets which sections were open.
  }
}

export function NavList({
  pathname,
  onNavigate,
  items = NAV_ITEMS,
  laterPhaseItems = LATER_PHASE_ITEMS,
}: {
  pathname: string;
  onNavigate?: () => void;
  items?: NavItem[];
  laterPhaseItems?: NavItem[];
}) {
  const blocks = useMemo(() => buildNavBlocks(items), [items]);
  const grouped = blocks.some((b) => b.kind === "group");
  const current = activeHref(items, pathname);
  const currentGroup = items.find((i) => i.href === current)?.group;

  const [open, setOpen] = useState<Set<NavGroupKey>>(() => {
    const revealed = lastRevealed ? items.find((i) => i.href === lastRevealed)?.group : undefined;
    return new Set([currentGroup, revealed].filter((g): g is NavGroupKey => Boolean(g)));
  });
  const [query, setQuery] = useState("");
  const searchId = useId();

  // Restore the sections opened last time (after mount: storage is not
  // available on the server).
  useEffect(() => {
    const saved = readOpenGroups();
    if (saved.length) setOpen((prev) => new Set([...prev, ...saved]));
  }, []);

  // Arriving on a page from anywhere (a dashboard link, a search result)
  // opens its section.
  useEffect(() => {
    if (currentGroup) setOpen((prev) => (prev.has(currentGroup) ? prev : new Set([...prev, currentGroup])));
  }, [currentGroup]);

  // The first-login tour points at menu items, so it asks for their section
  // to be opened first.
  // A layout effect so the listener is in place before the tour's own layout
  // effect asks (children's run first), and the section opens before paint.
  useLayoutEffect(() => {
    function onReveal(e: Event) {
      const href = (e as CustomEvent<string>).detail;
      const group = items.find((i) => i.href === href)?.group;
      if (group) setOpen((prev) => (prev.has(group) ? prev : new Set([...prev, group])));
    }
    window.addEventListener(NAV_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(NAV_REVEAL_EVENT, onReveal);
  }, [items]);

  function toggle(key: NavGroupKey) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeOpenGroups([...next]);
      return next;
    });
  }

  function navigated() {
    setQuery("");
    onNavigate?.();
  }

  const searching = grouped && query.trim().length > 0;
  const matches = searching ? items.filter((i) => matchesNavSearch(i, query)) : [];

  return (
    <nav aria-label="Main menu" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {grouped && (
        <div className="relative mb-2">
          <label htmlFor={searchId} className="sr-only">
            Find a page
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a page"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}

      {searching ? (
        matches.length > 0 ? (
          matches.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === current} onNavigate={navigated} />
          ))
        ) : (
          <p className="px-3 py-2 text-sm text-muted-foreground">No page matches “{query.trim()}”.</p>
        )
      ) : (
        blocks.map((block) =>
          block.kind === "item" ? (
            <NavLink key={block.item.href} item={block.item} active={block.item.href === current} onNavigate={navigated} />
          ) : (
            <NavSection
              key={block.key}
              label={block.label}
              items={block.items}
              open={open.has(block.key) || block.key === currentGroup}
              onToggle={() => toggle(block.key)}
              current={current}
              onNavigate={navigated}
            />
          ),
        )
      )}

      {!searching && laterPhaseItems.length > 0 && (
        <>
          <div className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Coming soon
          </div>
          {laterPhaseItems.map((item) => (
            <NavLink key={item.href} item={item} active={false} onNavigate={navigated} />
          ))}
        </>
      )}
    </nav>
  );
}

function NavSection({
  label,
  items,
  open,
  onToggle,
  current,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  open: boolean;
  onToggle: () => void;
  current: string | null;
  onNavigate: () => void;
}) {
  const panelId = useId();
  const holdsCurrent = items.some((i) => i.href === current);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-accent hover:text-accent-foreground",
          holdsCurrent ? "text-primary" : "text-foreground",
        )}
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
        <span className="flex-1">{label}</span>
        {!open && <span className="text-xs font-normal text-muted-foreground">{items.length}</span>}
      </button>
      {open && (
        <div id={panelId} className="ml-3 flex flex-col gap-1 border-l border-border pl-2">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={item.href === current} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  // Nav labels sit at font-medium, one step above the previous default
  // weight — the single deliberate typography change in the dashboard
  // redesign (brand faces themselves are unchanged: Hanken Grotesk +
  // Fraunces stay, the mockup's Newsreader/Plus Jakarta Sans were rejected).
  // The active item goes one step further to font-semibold so the current
  // page still reads as distinct now that everything around it is heavier.
  //
  // Set HERE, in the one shared NavLink, rather than per container: this
  // component backs the desktop rail, the mobile drawer AND the teacher
  // portal's sidebar, so a per-call-site weight would drift between them.
  const baseClasses = "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium";

  if (!item.enabled) {
    return (
      <span
        className={cn(baseClasses, "cursor-not-allowed text-muted-foreground/60")}
        title="Coming soon"
        aria-disabled="true"
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-tour-target={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        baseClasses,
        active
          ? "bg-primary/10 font-semibold text-primary"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  );
}
