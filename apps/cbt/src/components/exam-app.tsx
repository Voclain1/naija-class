"use client";

import { useCallback, useEffect, useState } from "react";

import type { CbtPackCandidate } from "@school-kit/types";

import { attemptKey, findCandidate, startAttempt, startWindowClosed, type LocalAttempt } from "@/lib/attempt";
import { latestStartTime } from "@/lib/format";
import { getAttempt, saveAttempt, type StoredPack } from "@/lib/store";
import { describeSync, syncSitting, type SyncState } from "@/lib/sync";

import { ConfirmScreen, HomeScreen, InvigilatorCode, SignInScreen, UnlockScreen, type OpenedPack } from "./before-exam";
import { ExamScreen } from "./exam-screen";
import { Button, Card, Screen } from "./ui";

// The lab app, one school (docs/modules/cbt.md D3–D7):
//
//   home ─▶ unlock ─▶ sign in ─▶ "is this you?" ─▶ exam ─▶ done ─▶ sign in …
//
// The opened questions live only in this component's memory. A reload, or a
// power cut, returns to home: the invigilator types the unlock code again, the
// student signs in again, and their saved attempt carries on where it was,
// with the clock still counting from their start.

type Stage =
  | { kind: "home" }
  | { kind: "unlock"; pack: StoredPack }
  | { kind: "signin"; error: string | null }
  | { kind: "confirm"; candidate: CbtPackCandidate; resume: LocalAttempt | null }
  | { kind: "late"; candidate: CbtPackCandidate }
  | { kind: "already"; candidate: CbtPackCandidate }
  | { kind: "exam"; candidate: CbtPackCandidate; attempt: LocalAttempt }
  | { kind: "done"; candidate: CbtPackCandidate; timeUp: boolean };

export function ExamApp({ slug }: { slug: string }) {
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [opened, setOpened] = useState<OpenedPack | null>(null);

  const lock = useCallback(() => {
    setOpened(null);
    setStage({ kind: "home" });
  }, []);

  async function find(typed: string) {
    if (!opened) return;
    const candidate = findCandidate(opened.payload, typed);
    if (!candidate) {
      setStage({
        kind: "signin",
        error: "That admission number is not on the list for this exam. Check it, or ask the invigilator.",
      });
      return;
    }
    const saved = await getAttempt(attemptKey(opened.pack.sittingId, candidate.studentId));
    if (saved?.submittedAt) return setStage({ kind: "already", candidate });
    if (saved) return setStage({ kind: "confirm", candidate, resume: saved });
    if (startWindowClosed(opened.pack.envelope, new Date())) return setStage({ kind: "late", candidate });
    setStage({ kind: "confirm", candidate, resume: null });
  }

  async function begin(candidate: CbtPackCandidate, resume: LocalAttempt | null) {
    if (!opened) return;
    const attempt = resume ?? startAttempt(opened.pack.sittingId, candidate.studentId, candidate.version, new Date());
    if (!resume) await saveAttempt(attempt);
    setStage({ kind: "exam", candidate, attempt });
  }

  const toSignIn = () => setStage({ kind: "signin", error: null });

  switch (stage.kind) {
    case "home":
      return <HomeScreen slug={slug} onOpen={(pack) => setStage({ kind: "unlock", pack })} />;
    case "unlock":
      return (
        <UnlockScreen
          pack={stage.pack}
          onBack={lock}
          onOpened={(o) => {
            setOpened(o);
            toSignIn();
          }}
        />
      );
  }
  if (!opened) return null;
  switch (stage.kind) {
    case "signin":
      return <SignInScreen opened={opened} onFind={(t) => void find(t)} onLock={lock} error={stage.error} />;
    case "confirm":
      return (
        <ConfirmScreen
          opened={opened}
          candidate={stage.candidate}
          resume={stage.resume}
          onStart={() => void begin(stage.candidate, stage.resume)}
          onBack={toSignIn}
        />
      );
    case "late":
      return (
        <Screen>
          <h1 className="font-serif text-3xl">{stage.candidate.displayName}</h1>
          <p className="rounded-md bg-amber-50 p-4">
            The latest start time for this exam ({latestStartTime(opened.pack.envelope)}) has passed. Ask the invigilator.
          </p>
          <Card>
            <InvigilatorCode
              opened={opened}
              label="Allow a late start"
              onConfirmed={() => setStage({ kind: "confirm", candidate: stage.candidate, resume: null })}
            />
          </Card>
          <Button variant="ghost" className="self-start" onClick={toSignIn}>
            Back
          </Button>
        </Screen>
      );
    case "already":
      return (
        <Screen>
          <h1 className="font-serif text-3xl">{stage.candidate.displayName}</h1>
          <p className="rounded-md bg-muted/40 p-4">You have already finished this exam on this computer.</p>
          <Button className="self-start" onClick={toSignIn}>
            Next student
          </Button>
        </Screen>
      );
    case "exam":
      return (
        <ExamScreen
          opened={opened}
          candidate={stage.candidate}
          initial={stage.attempt}
          onDone={(_, timeUp) => setStage({ kind: "done", candidate: stage.candidate, timeUp })}
        />
      );
    case "done":
      return <DoneScreen opened={opened} candidate={stage.candidate} timeUp={stage.timeUp} onNext={toSignIn} />;
  }
}

function DoneScreen({
  opened,
  candidate,
  timeUp,
  onNext,
}: {
  opened: OpenedPack;
  candidate: CbtPackCandidate;
  timeUp: boolean;
  onNext: () => void;
}) {
  const [sync, setSync] = useState<SyncState | null>(null);
  const { pack, key } = opened;

  useEffect(() => {
    const run = async () => setSync(await syncSitting(pack.slug, pack.sittingId, key));
    void run();
    const timer = setInterval(() => void run(), 15_000);
    window.addEventListener("online", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", run);
    };
  }, [pack.slug, pack.sittingId, key]);

  return (
    <Screen>
      <h1 className="font-serif text-3xl">{timeUp ? "Time is up" : "Exam finished"}</h1>
      <Card className="flex flex-col gap-2">
        <p className="text-lg">{candidate.displayName}, your answers have been saved.</p>
        <p className={sync?.kind === "SENT" ? "font-medium text-emerald-800" : "text-muted-foreground"} aria-live="polite">
          {sync ? describeSync(sync) : "Sending your answers…"}
        </p>
      </Card>
      <p className="text-sm text-muted-foreground">Please leave the computer as it is and tell the invigilator you have finished.</p>
      <Button variant="outline" className="self-start" onClick={onNext}>
        Next student
      </Button>
    </Screen>
  );
}
