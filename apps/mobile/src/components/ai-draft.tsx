import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { ASSIGNMENT_LIMITS, type AssignmentMarkingDto, type AssignmentSubmissionDto } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { collectStaffWork, staffDiscardDraft, staffDraftAll, staffDraftOne } from "../lib/api/staff-homework";
import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { TextField } from "./form";
import { Body, Button, Caption, Card, Label } from "./ui";

// Phase 9 / CP4b — AI drafts of marking feedback on the staff app's marking
// screen (docs/modules/phase-9.md §12). Shown only when the school has
// switched drafting on. A draft is never a mark: "Use draft" fills the
// teacher's own boxes, and only their "Save mark" writes anything. Drafts stay
// in memory; nothing here is written to the phone.

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** The marking guide (staff only) and "Draft feedback for all". */
export function AiDraftCard({
  homeworkId,
  data,
  onChanged,
}: {
  homeworkId: string;
  data: AssignmentMarkingDto;
  onChanged: (next?: AssignmentMarkingDto) => void;
}) {
  const [guide, setGuide] = useState(data.collection.markingGuide ?? "");
  const draftable = data.roster.filter((r) => r.status === "SUBMITTED" && r.draftStatus === null).length;
  const save = useMutation({
    mutationFn: () => collectStaffWork(homeworkId, { totalMarks: data.collection.totalMarks, markingGuide: guide.trim() }),
    onSuccess: (next) => onChanged(next),
    onError: (e) => Alert.alert("Not saved", message(e, "Could not save the marking guide.")),
  });
  const all = useMutation({
    mutationFn: () => staffDraftAll(homeworkId),
    onSuccess: ({ queued }) => {
      Alert.alert(
        queued === 0 ? "Nothing to draft" : "Drafting",
        queued === 0
          ? "Every typed answer still to mark already has a draft."
          : `Drafting ${queued} answer${queued === 1 ? "" : "s"}. Drafts appear under each student as they're ready.`,
      );
      onChanged();
    },
    onError: (e) => Alert.alert("Not started", message(e, "Could not start the drafts.")),
  });
  return (
    <Card>
      <Label>AI drafts (optional)</Label>
      <Caption>
        Ask for a suggested mark and feedback on typed answers, then check and change it before you save. Names are
        removed before anything is sent. Photos and PDFs are marked by hand.
      </Caption>
      <TextField
        label="Marking guide (staff only)"
        value={guide}
        onChangeText={setGuide}
        multiline
        maxLength={ASSIGNMENT_LIMITS.markingGuide}
        autoCapitalize="sentences"
      />
      <View style={styles.buttons}>
        <Button
          title="Save guide"
          variant="secondary"
          loading={save.isPending}
          disabled={guide.trim() === (data.collection.markingGuide ?? "")}
          onPress={() => save.mutate()}
        />
        <Button
          title="Draft feedback for all"
          variant="secondary"
          loading={all.isPending}
          disabled={draftable === 0}
          onPress={() => all.mutate()}
        />
      </View>
    </Card>
  );
}

/** One attempt's draft: ask for it, wait for it, use it or drop it. */
export function AiDraftPanel({
  attempt,
  onUse,
  onChanged,
}: {
  attempt: AssignmentSubmissionDto;
  onUse: (mark: number, feedback: string) => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const ask = useMutation({
    mutationFn: () => staffDraftOne(attempt.id),
    onSuccess: onChanged,
    onError: (e) => Alert.alert("No draft", message(e, "Could not ask for a draft.")),
  });
  const drop = useMutation({
    mutationFn: () => staffDiscardDraft(attempt.id),
    onSuccess: onChanged,
    onError: (e) => Alert.alert("Not removed", message(e, "Try again in a moment.")),
  });
  const draft = attempt.draft;
  if (!attempt.body) return null;
  if (!draft) {
    return <Button title="Draft with AI" variant="secondary" loading={ask.isPending} onPress={() => ask.mutate()} />;
  }
  if (draft.status === "PENDING") return <Caption>Drafting… You can keep marking meanwhile.</Caption>;
  if (draft.status === "FAILED") {
    return (
      <View style={[styles.box, { backgroundColor: `${colors.warning}33` }]}>
        <Body>No draft: {draft.failure}</Body>
        <View style={styles.buttons}>
          <Button title="Try again" variant="secondary" loading={ask.isPending} onPress={() => ask.mutate()} />
          <Button title="Dismiss" variant="secondary" disabled={drop.isPending} onPress={() => drop.mutate()} />
        </View>
      </View>
    );
  }
  if (draft.mark === null || draft.feedback === null) return null;
  return (
    <View style={[styles.box, { backgroundColor: `${colors.primary}1F` }]}>
      <Label>AI draft: check it before you use it</Label>
      <Body>Suggested mark: {draft.mark}</Body>
      <Body>{draft.feedback}</Body>
      {draft.reason ? <Caption>For you, not the student: {draft.reason}</Caption> : null}
      <View style={styles.buttons}>
        <Button title="Use draft" onPress={() => onUse(draft.mark!, draft.feedback!)} />
        <Button title="Discard" variant="secondary" disabled={drop.isPending} onPress={() => drop.mutate()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  box: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.sm },
});
