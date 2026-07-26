"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { NAV_ITEMS } from "./nav-items";

// Minimal, dependency-free command palette: filters the real nav (not a
// general command system — see the dashboard rebuild plan-first, "the
// command palette's full command set is out of scope for this pass").
// Triggered by ⌘K/Ctrl+K anywhere in the admin shell, or by clicking the
// search bar / "A · Command" quick action.
export function CommandDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      // Portal mounts synchronously before this effect runs; focusing here
      // (rather than autoFocus on the input) avoids a first-open race.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(q));
  }, [query]);

  if (!open || typeof document === "undefined") return null;

  function go(href: string) {
    router.push(href);
    onOpenChange(false);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/30 px-4 pt-[15vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Search or run a command"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) go(matches[0].href);
            }}
            placeholder="Search or run a command…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-2">
          {matches.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>
          )}
          {matches.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <button
                  type="button"
                  disabled={!item.enabled}
                  onClick={() => item.enabled && go(item.href)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:hover:bg-transparent"
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {!item.enabled && <span className="ml-auto text-xs">Coming soon</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

// Shared ⌘K/Ctrl+K keyboard listener — mount once in the admin layout.
export function useCommandDialogHotkey(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
