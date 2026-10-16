import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AssignmentMarkingDto, ScorePreviewRowDto, SimilarityAnswerDto, SimilarityReportDto } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { staffGradingScheme, staffPreviewScores, staffSaveScores } from "../lib/api/staff-gradebook";
import { staffSimilarity } from "../lib/api/staff-homework";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { ChoiceChips } from "./form";
import { Body, Button, Caption, Card, Label } from "./ui";

// Phase 9 / CP4.4 — on the staff app's marking screen (docs/modules/phase-9.md
// §11 CP4-D8, CP4-D9), the same two tools as the website:
//   - send the marked work to the gradebook through its own preview and save,
//     raw marks out of the work's total, scaled by the server (D60);
//   - check which typed answers share a lot of wording, shared passages
//     highlighted. Staff only, never stored, never part of a mark.
// Results stay in memory: nothing here is written to the phone.

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export function GradebookCard({ data, schoolId, userId }: { data: AssignmentMarkingDto; schoolId: string; userId: string }) {
  const scheme = useQuery({ queryKey: queryKeys.staffGradingScheme(schoolId, userId), queryFn: staffGradingScheme });
  const [componentId, setComponentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScorePreviewRowDto[] | null>(null);
  const marked = data.roster.filter((r) => r.status === "MARKED" && r.mark !== null);
  const names = new Map(data.roster.map((r) => [r.studentId, r.name]));
  const input = () => ({
    termId: data.termId!,
    subjectId: data.subjectId,
    rows: marked.map((r) => ({ studentId: r.studentId, componentId: componentId!, raw: { mark: r.mark!, outOf: data.collection.totalMarks } })),
  });
  const runPreview = useMutation({
    mutationFn: () => staffPreviewScores(input()),
    onSuccess: (res) => setPreview(res.rows),
    onError: (e) => Alert.alert("No preview", message(e, "Could not preview the gradebook marks.")),
  });
  const save = useMutation({
    // The same rows the preview showed; the server scales them again.
    mutationFn: () => staffSaveScores(input()),
    onSuccess: () => {
      setPreview(null);
      Alert.alert("Saved", `Saved ${marked.length} mark${marked.length === 1 ? "" : "s"} to the gradebook.`);
    },
    onError: (e) => Alert.alert("Not saved", message(e, "Could not save to the gradebook.")),
  });
  const components = scheme.data?.components ?? [];
  const component = components.find((c) => c.id === componentId);

  return (
    <Card>
      <Label>Send to the gradebook</Label>
      {!data.termId ? (
        <Body muted>There is no current term, so there is no gradebook to send to yet.</Body>
      ) : (
        <>
          <Caption>
            Each mark goes in as a mark out of {data.collection.totalMarks}, scaled to the column. You see every mark
            before anything is saved. {marked.length} marked
            {data.counts.submitted > 0 ? `; ${data.counts.submitted} still to mark are not sent` : ""}.
          </Caption>
          <ChoiceChips
            label="Gradebook column"
            options={components.map((c) => ({ value: c.id, label: `${c.label} (${c.weight})` }))}
            value={componentId}
            onChange={(v) => {
              setComponentId(v);
              setPreview(null);
            }}
          />
          {preview ? (
            <View style={styles.list}>
              <Body>
                {component ? `${component.label}, out of ${component.weight}` : "Gradebook"}: {preview.length} mark
                {preview.length === 1 ? "" : "s"}
              </Body>
              {preview.map((p) => (
                <Caption key={p.studentId}>
                  {names.get(p.studentId)}: {p.raw?.mark}/{p.raw?.outOf} → {p.score}
                </Caption>
              ))}
              <Caption>Saving replaces any marks already in this column for these students.</Caption>
              <View style={styles.buttons}>
                <Button title="Save to gradebook" loading={save.isPending} onPress={() => save.mutate()} />
                <Button title="Back" variant="secondary" disabled={save.isPending} onPress={() => setPreview(null)} />
              </View>
            </View>
          ) : (
            <Button
              title="Preview gradebook marks"
              variant="secondary"
              loading={runPreview.isPending}
              disabled={!componentId || marked.length === 0}
              onPress={() => runPreview.mutate()}
            />
          )}
        </>
      )}
    </Card>
  );
}

function SharedAnswer({ answer }: { answer: SimilarityAnswerDto }) {
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      <Label>{answer.name}</Label>
      <View style={[styles.answer, { backgroundColor: `${colors.mutedForeground}14` }]}>
        <Text style={[styles.text, { color: colors.foreground }]}>
          {answer.segments.map((s, i) => (
            <Text key={i} style={s.shared ? { backgroundColor: `${colors.warning}55` } : undefined}>
              {s.text}
            </Text>
          ))}
        </Text>
      </View>
    </View>
  );
}

export function SimilarityCard({ homeworkId }: { homeworkId: string }) {
  const [report, setReport] = useState<SimilarityReportDto | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const check = useMutation({
    mutationFn: () => staffSimilarity(homeworkId),
    onSuccess: (r) => {
      setReport(r);
      setOpen(null);
    },
    onError: (e) => Alert.alert("Not checked", message(e, "Could not compare the answers. Try again.")),
  });
  return (
    <Card>
      <Label>Similar wording</Label>
      <Caption>
        Compares typed answers of 50 words or more, leaving out wording from the homework itself. Not a judgement and
        never part of a mark; students and parents don&apos;t see it, and it isn&apos;t saved.
      </Caption>
      <Button
        title={report ? "Check again" : "Check for similar wording"}
        variant="secondary"
        loading={check.isPending}
        onPress={() => check.mutate()}
      />
      {report ? (
        <>
          <Body>
            Compared {report.compared} typed answer{report.compared === 1 ? "" : "s"}
            {report.skippedShort > 0 ? `; ${report.skippedShort} too short to compare` : ""}.{" "}
            {report.pairs.length === 0 ? "No two answers share a lot of wording." : ""}
          </Body>
          {report.pairs.map((p, i) => (
            <View key={`${p.a.studentId}-${p.b.studentId}`} style={styles.list}>
              <Body>
                {p.a.name} and {p.b.name} share a lot of wording (about {p.overlapPercent}%): worth a look.
              </Body>
              <Button
                title={open === i ? "Hide the answers" : "Show the answers"}
                variant="secondary"
                onPress={() => setOpen(open === i ? null : i)}
              />
              {open === i ? (
                <>
                  <Caption>The wording both answers share is highlighted.</Caption>
                  <SharedAnswer answer={p.a} />
                  <SharedAnswer answer={p.b} />
                </>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  answer: { padding: spacing.sm, borderRadius: radii.sm },
  text: { fontFamily: fonts.sans, fontSize: fontSizes.body, lineHeight: fontSizes.body * 1.45 },
});
