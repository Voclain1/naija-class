"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MAX_STUDENT_CORRECTIONS, STUDENT_CORRECTION_FIELDS, type StudentDto, type PrepareStudentCorrectionsInput } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { CorrectionReview } from "@/components/students/corrections/review";
import { useAuth } from "@/lib/auth/use-auth";
import { hasPermission } from "@/lib/auth/has-permission";
import { ApiError } from "@/lib/api-client";
import { listStudents } from "@/lib/students/students-api";
import { correctionDraft, correctionChanges, FIELD_LABELS, type CorrectionDraft } from "@/lib/student-corrections/draft";
import { correctionsApi } from "@/lib/student-corrections/api";
import { CorrectionSession } from "@/lib/student-corrections/session";
const control = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50";
export default function StudentCorrectionsPage() {
  const { user, school, status, roles, permissions } = useAuth();
  if (status === "loading") return <p role="status">Loading student corrections…</p>;
  if (status !== "authed" || !hasPermission(permissions, "student.read") || !hasPermission(permissions, "student.update") || !roles.some((r) => r.key === "owner" || r.key === "admin")) return <p role="alert">Student corrections are not available for this account.</p>;
  return <Workspace key={`${school?.id}:${user?.id}`} />;
}
function Workspace() {
  const [mode, setMode] = useState<"loading" | "on" | "off" | "error">("loading");
  const [attempt, setAttempt] = useState(0); const [session, setSession] = useState<CorrectionSession | null>(null);
  const [search, setSearch] = useState(""); const [results, setResults] = useState<StudentDto[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false); const [error, setError] = useState<string | null>(null); const [drafts, setDrafts] = useState<CorrectionDraft[]>([]);
  const [problems, setProblems] = useState<Record<string, string[]>>({}); const [reviewing, setReviewing] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const s = new CorrectionSession(); setSession(s);
    const reviewId = new URL(window.location.href).searchParams.get("review");
    if (reviewId && /^[0-9a-f-]{36}$/i.test(reviewId)) { setReviewing(true); void s.recover(reviewId); }
    return () => { s.dispose(); mounted.current = false; };
  }, []);
  useEffect(() => {
    let cancelled = false; setMode("loading");
    void correctionsApi.available().then(({ enabled }) => { if (!cancelled) setMode(enabled === true ? "on" : enabled === false ? "off" : "error"); }).catch((e) => { if (!cancelled) setMode(e instanceof ApiError && e.status === 404 ? "off" : "error"); });
    return () => { cancelled = true; };
  }, [attempt]);
  async function find(next?: string) {
    const id = ++requestId.current; setSearching(true); setSearched(true); setError(null); if (!next) { setResults([]); setCursor(null); }
    try { const r = await listStudents({ search: search.trim() || undefined, limit: 20, ...(next ? { cursor: next } : {}) }); if (mounted.current && requestId.current === id) { setResults((old) => next ? [...old, ...r.data.filter((s) => !old.some((o) => o.id === s.id))] : r.data); setCursor(r.meta.cursor ?? null); } }
    catch (e) { if (mounted.current && requestId.current === id) setError(e instanceof ApiError ? e.message : "Could not load students."); }
    finally { if (mounted.current && requestId.current === id) setSearching(false); }
  }
  function edit(index: number, patch: Partial<CorrectionDraft>) { setDrafts((all) => all.map((d, i) => i === index ? { ...d, ...patch } : d)); setProblems({}); }
  function review() {
    const corrections: PrepareStudentCorrectionsInput["corrections"] = []; const errors: Record<string, string[]> = {};
    for (const d of drafts) { const r = correctionChanges(d); if (r.errors.length) errors[d.studentId] = r.errors; else if (r.changes) corrections.push({ studentId: d.studentId, changes: r.changes }); }
    setProblems(errors); if (Object.keys(errors).length) { setError("Fix the highlighted students before reviewing."); return; }
    if (!corrections.length) { setError("There are no record changes to review."); return; }
    if (mode !== "on" || !session) return;
    setError(null); setReviewing(true); void session.start(corrections);
  }
  function closeReview(completed: boolean) {
    setReviewing(false); setProblems({}); setError(null); setSearched(false);
    if (completed) { setDrafts([]); setResults([]); setCursor(null); }
  }
  return <div className="ph-no-capture mx-auto max-w-6xl space-y-6" data-sentry-mask>
    <header className="space-y-2"><Link href="/students" className="text-sm underline">Back to student roster</Link><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Correct student records together.</h1><p className="max-w-3xl text-sm text-muted-foreground">Find existing students, change only the fields that need correcting, then review every before/after value. Up to {MAX_STUDENT_CORRECTIONS} students are applied together after your confirmation.</p></header>
    <p className="rounded-xl bg-muted/50 p-4 text-sm">This workflow changes names, date of birth, gender and email only. Admission numbers, class placement, guardian links and status changes keep their existing screens. Nothing goes to an AI model.</p>
    {mode === "loading" && <p role="status">Checking correction availability…</p>}
    {mode === "off" && <div role="status" className="rounded-lg bg-muted/50 p-4 text-sm">Reviewed batch corrections are not enabled for this school. <Link href="/students" className="underline">Open the roster</Link> to use the existing individual Edit action. Saved review links remain readable for your account.</div>}
    {mode === "error" && <div role="alert"><p>Could not check correction availability.</p><Button onClick={() => setAttempt((n) => n + 1)}>Retry availability check</Button></div>}
    {mode === "on" && <>
      <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); void find(); }}><label className="min-w-0 flex-1 space-y-1 text-sm"><span>Find existing students</span><input className={control} value={search} onChange={(e) => { setSearch(e.target.value); setSearched(false); setResults([]); setCursor(null); requestId.current++; setSearching(false); }} placeholder="Name or admission number" /></label><Button type="submit" disabled={searching || reviewing}>{searching ? "Searching…" : "Search roster"}</Button></form>
      {searched && !searching && !error && results.length === 0 && <p role="status">No matching students. Try a name or admission number.</p>}
      {results.length > 0 && <section className="space-y-2" aria-label="Roster search results"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Choose students from the roster</h2><Button type="button" variant="outline" disabled={reviewing || drafts.length >= MAX_STUDENT_CORRECTIONS} onClick={() => setDrafts((all) => [...all, ...results.filter((s) => !all.some((d) => d.studentId === s.id)).slice(0, MAX_STUDENT_CORRECTIONS - all.length).map(correctionDraft)])}>Add loaded search results</Button></div><ul className="grid gap-2 sm:grid-cols-2">{results.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-medium">{s.firstName} {s.lastName}</p><p className="text-xs text-muted-foreground">{s.admissionNumber} · {s.status}</p></div><Button type="button" variant="outline" disabled={reviewing || drafts.length >= MAX_STUDENT_CORRECTIONS || drafts.some((d) => d.studentId === s.id)} onClick={() => setDrafts((all) => all.length >= MAX_STUDENT_CORRECTIONS || all.some((d) => d.studentId === s.id) ? all : [...all, correctionDraft(s)])}>Add {s.firstName} {s.lastName}</Button></li>)}</ul>{cursor && <Button variant="outline" disabled={searching || reviewing} onClick={() => void find(cursor)}>Load more matching students</Button>}</section>}
      {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
      {drafts.length > 0 && <section className="space-y-3" aria-label="Correction editor"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{drafts.length} students in this batch</h2><Button disabled={reviewing} onClick={review}>Review record changes</Button></div><p className="text-sm text-muted-foreground">Unedited fields are left alone. To remove a recorded middle name or email, tick its Clear option explicitly. Drafts are lost if you leave or reload before creating a saved review.</p>{drafts.map((d, index) => <fieldset key={d.studentId} disabled={reviewing} className="space-y-3 rounded-xl border bg-card p-4"><legend className="px-1 font-semibold">{d.originalName} · {d.admissionNumber}</legend>{problems[d.studentId]?.map((message) => <p role="alert" className="text-sm text-destructive" key={message}>{message}</p>)}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{STUDENT_CORRECTION_FIELDS.map((field) => <label key={field} className="space-y-1 text-sm"><span>{FIELD_LABELS[field]}</span>{field === "gender" ? <select aria-label={`${FIELD_LABELS[field]} for ${d.admissionNumber}`} className={control} value={d.values[field]} onChange={(e) => edit(index, { values: { ...d.values, [field]: e.target.value } })}><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select> : <input aria-label={`${FIELD_LABELS[field]} for ${d.admissionNumber}`} type={field === "dateOfBirth" ? "date" : field === "email" ? "email" : "text"} maxLength={field === "email" ? 254 : 60} className={control} value={d.values[field]} disabled={(field === "email" && d.clearEmail) || (field === "middleName" && d.clearMiddleName)} onChange={(e) => edit(index, { values: { ...d.values, [field]: e.target.value } })} />}</label>)}</div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={d.clearMiddleName} disabled={!d.before.middleName} onChange={(e) => edit(index, { clearMiddleName: e.target.checked })} />Clear middle name for {d.admissionNumber}</label><label className="flex items-center gap-2"><input type="checkbox" checked={d.clearEmail} disabled={!d.before.email} onChange={(e) => edit(index, { clearEmail: e.target.checked })} />Clear email for {d.admissionNumber}</label><Button type="button" variant="outline" size="sm" onClick={() => setDrafts((all) => all.filter((r) => r.studentId !== d.studentId))}>Remove {d.admissionNumber} from batch</Button></div></fieldset>)}</section>}
    </>}
    {reviewing && session && <CorrectionReview session={session} onClose={closeReview} />}
  </div>;
}
