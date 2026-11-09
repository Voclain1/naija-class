"use client";

import { ArrowUp, BookOpen, Eraser, Minus, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ASSISTANT_MAX_REQUEST_CHARS,
  ASSISTANT_WORKFLOWS,
  ASSISTANT_WORKFLOW_LABELS,
  type AssistantCapabilitiesDto,
  type AssistantWorkflow,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { assistantApi } from "@/lib/assistant/api";
import type { AssistantMessage } from "@/lib/assistant/store";
import { stripBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";

import { useAssistant } from "./assistant-provider";
import { TaskCard } from "./cards/task-card";

// The SchoolKit Assistant: one launcher and one panel in the staff shell
// (docs/modules/assistant-workspace.md). Mounted by the (admin) and (teacher)
// layouts; the conversation itself lives in AssistantProvider, above them.
//
// The panel never reads the page under it: no form values, messages, URLs or
// student details are taken from the screen. The only page signal it uses is
// the pathname’s first segment, to order the suggested tasks.

export function AssistantDock() {
  const { state, caps, store } = useAssistant();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const open = state.open && !!caps?.enabled;

  const setOpen = useCallback((next: boolean) => {
    store.setOpen(next);
    if (!next) requestAnimationFrame(() => launcherRef.current?.focus());
  }, [store]);

  // Alt+Shift+A opens or minimises it from anywhere in the staff app.
  useEffect(() => {
    if (!caps?.enabled) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === "A" || e.key === "a")) { e.preventDefault(); setOpen(!store.snapshot().open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [caps?.enabled, setOpen, store]);

  if (!caps?.enabled) return null;
  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label="Open SchoolKit Assistant"
          aria-keyshortcuts="Alt+Shift+A"
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg ring-1 ring-black/5 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none print:hidden sm:right-6"
        >
          <Sparkles className="h-5 w-5" aria-hidden />
          <span className="hidden sm:inline">SchoolKit Assistant</span>
          {store.hasOpenOperation() && <span className="h-2 w-2 rounded-full bg-secondary" aria-label="A task is waiting for you" />}
        </button>
      )}
      {open && <Panel caps={caps} onMinimise={() => setOpen(false)} />}
    </>
  );
}

function Panel({ caps, onMinimise }: { caps: AssistantCapabilitiesDto; onMinimise: () => void }) {
  const { state, store } = useAssistant();
  const titleId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { composerRef.current?.focus(); }, []);
  // Keep the newest message in view without stealing focus.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); onMinimise(); }
  }

  const live = Object.values(state.tasks).some((t) => t.status === "confirming" || t.status === "uncertain");

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      data-sentry-mask
      className="ph-no-capture fixed inset-0 z-50 flex h-[100dvh] flex-col bg-card text-card-foreground shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right-8 print:hidden sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(30rem,100vw)] sm:border-l sm:border-border"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-base font-semibold leading-tight">SchoolKit Assistant</h2>
          <p className="text-xs text-muted-foreground">Prepares school tasks for you to review and approve.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-2"
          onClick={() => (live ? setConfirmClear(true) : store.clear("user"))}
          disabled={state.messages.length === 0}
          aria-label="Clear conversation"
          title="Clear conversation"
        >
          <Eraser className="h-4 w-4" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-9 px-2" onClick={onMinimise} aria-label="Minimise assistant" title="Minimise (Esc)">
          <Minus className="h-4 w-4" aria-hidden />
        </Button>
      </header>

      {confirmClear && (
        <div role="alertdialog" aria-label="Clear conversation" className="mx-4 mt-3 rounded-lg bg-secondary/20 p-3 text-sm sm:mx-5">
          <p>A task’s outcome is still being checked. Clearing keeps a link to check it, but removes everything you typed. Clearing does not cancel anything on the server.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => { store.clear("user"); setConfirmClear(false); }}>Clear anyway</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmClear(false)}>Keep it</Button>
          </div>
        </div>
      )}

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
        {state.notice && (
          <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">
            {state.notice}{" "}
            <button type="button" className="underline" onClick={() => store.dismissNotice()}>Dismiss</button>
          </p>
        )}
        {state.messages.length === 0 ? <Welcome caps={caps} /> : (
          <ol className="space-y-4">
            {state.messages.map((m) => <Message key={m.id} message={m} caps={caps} />)}
          </ol>
        )}
      </div>

      <Suggestions caps={caps} />
      <Composer caps={caps} inputRef={composerRef} />
    </div>
  );
}

function Welcome({ caps }: { caps: AssistantCapabilitiesDto }) {
  const any = ASSISTANT_WORKFLOWS.some((w) => caps.workflows[w].available);
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">What do you need done?</p>
      <p className="text-muted-foreground">
        {any
          ? "Describe the task in your own words, or pick one below. I’ll gather what’s needed, show you exactly what will change, and only act when you approve it."
          : "Your account can search the Getting started guide here. Ask a question about using SchoolKit."}
      </p>
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Your requests are understood on this device and aren’t sent to an AI model. Don’t type passwords, PINs or bank details.
      </p>
    </div>
  );
}

function Message({ message: m, caps }: { message: AssistantMessage; caps: AssistantCapabilitiesDto }) {
  const { store } = useAssistant();
  if (m.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          <span className="sr-only">You: </span>{m.text}
        </p>
      </li>
    );
  }
  const bubble = "max-w-full break-words rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm";
  switch (m.kind) {
    case "text":
      return <li><p className={bubble}><span className="sr-only">Assistant: </span>{m.text}</p></li>;
    case "refusal":
      return (
        <li className="space-y-2">
          <p className={bubble}><span className="sr-only">Assistant: </span>{m.text}</p>
          {m.next && m.next !== "help" && caps.workflows[m.next].available && (
            <Button size="sm" variant="outline" onClick={() => store.start(m.next as AssistantWorkflow, caps)}>{ASSISTANT_WORKFLOW_LABELS[m.next]}</Button>
          )}
          {m.next === "help" && <Link href="/help/guide" className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"><BookOpen className="h-4 w-4" aria-hidden />Open the Getting started guide</Link>}
        </li>
      );
    case "clarify":
      return (
        <li className="space-y-2">
          <p className={bubble}><span className="sr-only">Assistant: </span>{m.text}</p>
          <div className="flex flex-wrap gap-2">
            {m.options.map((w) => (
              <Button key={w} size="sm" variant="outline" disabled={!caps.workflows[w].available} onClick={() => store.start(w, caps)}>{ASSISTANT_WORKFLOW_LABELS[w]}</Button>
            ))}
          </div>
        </li>
      );
    case "help":
      return <li><HelpAnswer id={m.id} query={m.query} hits={m.hits} /></li>;
    case "task":
      return (
        <li className="space-y-2">
          <p className={bubble}><span className="sr-only">Assistant: </span>{m.text}</p>
          <TaskCard taskId={m.taskId} caps={caps} />
        </li>
      );
  }
}

function HelpAnswer({ id, query, hits }: { id: string; query: string; hits: { anchor: string; title: string; path: string; excerpt: string }[] | null }) {
  const { store } = useAssistant();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (hits) return;
    let live = true;
    assistantApi.help(query).then((r) => { if (live) store.setHelpHits(id, r.hits); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [hits, id, query, store]);
  if (error) return <p className="rounded-2xl bg-muted px-3.5 py-2 text-sm">I couldn’t search the guide just now. <Link className="underline" href="/help/guide">Open the guide</Link>.</p>;
  if (!hits) return <p className="rounded-2xl bg-muted px-3.5 py-2 text-sm" role="status">Searching the guide…</p>;
  if (hits.length === 0) return <p className="rounded-2xl bg-muted px-3.5 py-2 text-sm">The guide doesn’t seem to cover that. <Link className="underline" href="/help/guide">Browse the guide</Link>.</p>;
  return (
    <div className="space-y-2">
      <p className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm"><span className="sr-only">Assistant: </span>From the Getting started guide:</p>
      {hits.map((h) => (
        <article key={h.anchor} className="rounded-xl border border-border bg-background p-3 text-sm">
          <h3 className="font-medium">{h.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{h.path}</p>
          <p className="mt-2 line-clamp-5 whitespace-pre-line text-muted-foreground">{h.excerpt}</p>
          <Link className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/help/guide#${h.anchor}`}>Read the full section</Link>
        </article>
      ))}
    </div>
  );
}

/** Task suggestions ordered by the page’s area only (never its contents). */
function Suggestions({ caps }: { caps: AssistantCapabilitiesDto }) {
  const { store } = useAssistant();
  const area = stripBasePath(usePathname() ?? "/").split("/")[1] ?? "";
  const order: AssistantWorkflow[] =
    area === "finance" ? ["invoices", "reminders", "intake", "corrections"] : area === "students" ? ["intake", "corrections", "invoices", "reminders"] : [...ASSISTANT_WORKFLOWS];
  const shown = order.filter((w) => caps.workflows[w].available);
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Suggested tasks" className="border-t border-border px-4 pt-3 sm:px-5">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {shown.map((w) => (
          <li key={w} className="shrink-0">
            <button type="button" onClick={() => store.start(w, caps)} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
              {ASSISTANT_WORKFLOW_LABELS[w]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Composer({ caps, inputRef }: { caps: AssistantCapabilitiesDto; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const { store } = useAssistant();
  // The draft lives in this component’s memory only (never storage).
  const [text, setText] = useState("");
  const id = useId();
  function submit() {
    if (!text.trim()) return;
    store.send(text, caps);
    setText("");
  }
  return (
    <form
      className="flex items-end gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <label htmlFor={id} className="sr-only">Describe a task</label>
      <textarea
        id={id}
        ref={inputRef}
        data-ph-mask
        data-sentry-mask
        autoComplete="off"
        rows={2}
        maxLength={ASSISTANT_MAX_REQUEST_CHARS}
        value={text}
        onChange={(e) => { setText(e.target.value); store.touch(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="e.g. Remind parents with overdue fees in JSS 1"
        className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
      />
      <Button type="submit" size="sm" className={cn("h-11 w-11 rounded-full p-0")} disabled={!text.trim()} aria-label="Send request">
        <ArrowUp className="h-5 w-5" aria-hidden />
      </Button>
    </form>
  );
}
