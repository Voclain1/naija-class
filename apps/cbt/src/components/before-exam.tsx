"use client";

import { useCallback, useEffect, useState } from "react";

import {
  WrongUnlockCodeError,
  deriveSyncKey,
  formatUnlockCode,
  normaliseCbtCode,
  openPackInBrowser,
  type CbtCryptoKey,
  type CbtPackCandidate,
  type CbtPackPayload,
} from "@school-kit/types";

import { DeliveryError, OfflineError, downloadPack } from "@/lib/api";
import { formatClock, remainingMs, type LocalAttempt } from "@/lib/attempt";
import { describeWhen } from "@/lib/format";
import { isUnlockCode } from "@/lib/invigilator";
import { listPacks, saveSyncKey, savePack, type StoredPack } from "@/lib/store";
import { describeSync, syncSitting, type SyncState } from "@/lib/sync";

import { Button, Card, ErrorNote, Input, Screen } from "./ui";

// The screens before a student starts (docs/modules/cbt.md D3, D5): the
// machine's downloaded exams, unlocking one, and the student finding their
// name. Each is a plain component the ExamApp shows in turn.

// ---------------------------------------------------------------------------
// Home — download ahead of time; send any answers still on this machine
// ---------------------------------------------------------------------------

export function HomeScreen({ slug, onOpen }: { slug: string; onOpen: (pack: StoredPack) => void }) {
  const [packs, setPacks] = useState<StoredPack[] | null>(null);
  const [sync, setSync] = useState<Record<string, SyncState>>({});
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listPacks(slug);
    setPacks(list);
    // Answers left from earlier students go whenever the internet is up.
    for (const p of list) {
      const state = await syncSitting(slug, p.sittingId);
      setSync((s) => ({ ...s, [p.sittingId]: state }));
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function download(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { envelope } = await downloadPack(slug, normaliseCbtCode(code));
      await savePack({ sittingId: envelope.sittingId, slug, envelope, downloadedAt: new Date().toISOString() });
      setCode("");
      await refresh();
    } catch (err) {
      setError(
        err instanceof OfflineError
          ? "No internet connection. The exam must be downloaded while the internet is on."
          : err instanceof DeliveryError
            ? err.message
            : "Could not download the exam. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">SchoolKit Exams</p>
        <h1 className="font-serif text-3xl">Exams on this computer</h1>
      </header>

      {packs === null ? null : packs.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-4 text-sm text-muted-foreground">No exam has been downloaded onto this computer yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {packs.map((p) => (
            <li key={p.sittingId}>
              <Card className="flex flex-col gap-3">
                <div>
                  <p className="font-medium">{p.envelope.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.envelope.classLevelName} {p.envelope.subjectName} · {describeWhen(p.envelope)}
                  </p>
                  {sync[p.sittingId] ? <p className="mt-1 text-sm">{describeSync(sync[p.sittingId]!)}</p> : null}
                </div>
                <Button onClick={() => onOpen(p)} className="self-start">
                  Start this exam
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <form onSubmit={download} className="flex flex-col gap-3">
          <label htmlFor="access-code" className="font-medium">
            Download an exam
          </label>
          <p className="text-sm text-muted-foreground">
            Type the access code from the invigilator sheet. The exam stays locked until the unlock code is typed at the start.
          </p>
          <Input
            id="access-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            className="font-mono tracking-widest"
          />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" disabled={busy || normaliseCbtCode(code).length !== 6} className="self-start">
            {busy ? "Downloading…" : "Download"}
          </Button>
        </form>
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Unlock — the invigilator types the unlock code
// ---------------------------------------------------------------------------

export interface OpenedPack {
  pack: StoredPack;
  payload: CbtPackPayload;
  key: CbtCryptoKey;
}

export function UnlockScreen({ pack, onOpened, onBack }: { pack: StoredPack; onOpened: (o: OpenedPack) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = await openPackInBrowser(pack.envelope, code);
      const key = await deriveSyncKey(code, pack.sittingId, pack.envelope.kdf.iterations);
      await saveSyncKey(pack.sittingId, key);
      onOpened({ pack, payload, key });
    } catch (err) {
      setError(err instanceof WrongUnlockCodeError ? err.message : "Could not open the exam on this computer.");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {pack.envelope.schoolName} · {pack.envelope.classLevelName} {pack.envelope.subjectName}
        </p>
        <h1 className="font-serif text-3xl">{pack.envelope.title}</h1>
        <p className="text-sm">{describeWhen(pack.envelope)}</p>
      </header>
      <Card>
        <form onSubmit={unlock} className="flex flex-col gap-3">
          <label htmlFor="unlock-code" className="font-medium">
            Invigilator: unlock code
          </label>
          <Input
            id="unlock-code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            className="font-mono tracking-widest"
          />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || normaliseCbtCode(code).length !== 12}>
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          </div>
        </form>
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Sign in — admission number, then "Is this you?" (D5)
// ---------------------------------------------------------------------------

export function SignInScreen({
  opened,
  onFind,
  onLock,
  error,
}: {
  opened: OpenedPack;
  onFind: (admissionNumber: string) => void;
  onLock: () => void;
  error: string | null;
}) {
  const [typed, setTyped] = useState("");
  const env = opened.pack.envelope;
  return (
    <Screen>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {env.schoolName} · {env.classLevelName} {env.subjectName}
        </p>
        <h1 className="font-serif text-3xl">{env.title}</h1>
      </header>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onFind(typed);
          }}
          className="flex flex-col gap-3"
        >
          <label htmlFor="admission-number" className="font-medium">
            Your admission number
          </label>
          <Input id="admission-number" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <Button type="submit" disabled={!typed.trim()} className="self-start">
            Continue
          </Button>
        </form>
      </Card>
      <button type="button" onClick={onLock} className="self-start text-sm text-muted-foreground underline">
        Invigilator: lock this computer
      </button>
    </Screen>
  );
}

export function ConfirmScreen({
  opened,
  candidate,
  resume,
  onStart,
  onBack,
}: {
  opened: OpenedPack;
  candidate: CbtPackCandidate;
  resume: LocalAttempt | null;
  onStart: () => void;
  onBack: () => void;
}) {
  const env = opened.pack.envelope;
  return (
    <Screen>
      <h1 className="font-serif text-3xl">Is this you?</h1>
      <Card className="flex flex-col gap-1">
        <p className="text-2xl font-medium">{candidate.displayName}</p>
        <p className="text-muted-foreground">
          {candidate.armName} · {candidate.admissionNumber}
        </p>
      </Card>
      {resume ? (
        <p className="rounded-md bg-muted/40 p-4">
          Welcome back. Your answers are saved. Time left: <strong>{formatClock(remainingMs(resume, env.durationMinutes, new Date()))}</strong>
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-4 text-sm">
          <p>
            {opened.payload.questionCount} questions · {env.durationMinutes} minutes. Your time starts when you press Start.
          </p>
          <p>Choose one answer for each question. You can change an answer until you finish.</p>
          {opened.payload.instructions ? <p className="whitespace-pre-wrap">{opened.payload.instructions}</p> : null}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={onStart}>{resume ? "Carry on" : "Yes, start the exam"}</Button>
        <Button variant="outline" onClick={onBack}>
          No, that is not me
        </Button>
      </div>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Messages that need the invigilator
// ---------------------------------------------------------------------------

/** A form for the invigilator to prove they hold the unlock code again. */
export function InvigilatorCode({
  opened,
  label,
  onConfirmed,
}: {
  opened: OpenedPack;
  label: string;
  onConfirmed: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const ok = await isUnlockCode(code, opened.pack.sittingId, opened.pack.envelope.kdf.iterations, opened.key);
        setBusy(false);
        if (ok) onConfirmed();
        else setError("That is not the unlock code for this exam.");
      }}
    >
      <label htmlFor="invigilator-code" className="text-sm font-medium">
        Invigilator: unlock code
      </label>
      <Input
        id="invigilator-code"
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        placeholder={formatUnlockCode("XXXXXXXXXXXX")}
        className="font-mono tracking-widest"
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <Button type="submit" disabled={busy || normaliseCbtCode(code).length !== 12} className="self-start">
        {busy ? "Checking…" : label}
      </Button>
    </form>
  );
}
