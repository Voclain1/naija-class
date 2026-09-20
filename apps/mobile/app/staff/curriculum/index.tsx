import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import {
  staffApproveCurriculum,
  staffDeleteCurriculum,
  staffListCurriculum,
  staffPasteCurriculum,
  staffUploadCurriculumFile,
} from "../../../src/lib/api/staff-curriculum";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { EmptyState, ScreenHeader, Skeleton } from "../../../src/components/layout";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// CP7 (5) — the scheme of work that lesson notes are grounded in.
//
// D26 shapes this screen. PASTE is first and is the primary path: on a phone
// it needs no file manager, no storage permission and no native picker, and
// the endpoint is first-class rather than a fallback. The file picker is
// second, for teachers who really do have a PDF or Word file on the handset.
//
// PHOTOGRAPHS ARE NOT SUPPORTED, and the screen says so before anyone tries.
// The server parses documents; there is no OCR on this path. A teacher who
// photographs a syllabus and waits for a parse failure would reasonably
// conclude the feature is broken.

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

function describeStatus(status: string): string {
  switch (status) {
    case "READY":
      return "Ready — lesson notes can use this.";
    case "AWAITING_REVIEW":
      return "Waiting for you to check it.";
    case "PENDING":
    case "PROCESSING":
    case "EMBEDDING":
      return "Still being read…";
    case "FAILED":
      return "Could not be read.";
    default:
      return status;
  }
}

function describeFailure(error: unknown, fallback: string): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing was sent — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (error.code === "FILE_TOO_LARGE") {
      return "That file is larger than 10 MB. Paste the text instead, or split the file.";
    }
    return error.message || fallback;
  }
  return fallback;
}

export default function CurriculumScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 60_000,
  });

  const documents = useQuery({
    queryKey: queryKeys.staffCurriculum(schoolId, userId),
    queryFn: staffListCurriculum,
    enabled: ready,
    // Documents move through PENDING → … → AWAITING_REVIEW on the worker, so a
    // short staleness keeps the list honest without polling.
    staleTime: 10_000,
  });

  const [armId, setArmId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const arms = scope.data?.classArms ?? [];
  const subjects = armId ? (scope.data?.subjectsByArm[armId] ?? []) : [];
  const selectedArm = arms.find((arm) => arm.id === armId) ?? null;

  function refresh(): void {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.staffCurriculum(schoolId, userId),
    });
  }

  const paste = useMutation({
    mutationFn: () =>
      staffPasteCurriculum({
        classLevelId: selectedArm!.classLevelId,
        subjectId: subjectId!,
        title: title.trim(),
        content: content.trim(),
      }),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: () => {
      setContent("");
      setTitle("");
      setNotice("Received. It takes a moment to read — check back shortly to confirm it.");
      refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error, "That text was not accepted.")),
  });

  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return null;
      const asset = picked.assets[0];
      return staffUploadCurriculumFile(
        {
          classLevelId: selectedArm!.classLevelId,
          subjectId: subjectId!,
          title: title.trim() || asset.name,
        },
        {
          uri: asset.uri,
          name: asset.name,
          mimeType: asset.mimeType ?? "application/pdf",
        },
      );
    },
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (result) => {
      if (result === null) return; // the teacher backed out of the picker
      setTitle("");
      setNotice("Received. It takes a moment to read — check back shortly to confirm it.");
      refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error, "That file was not accepted.")),
  });

  const approve = useMutation({
    mutationFn: (documentId: string) => staffApproveCurriculum(documentId),
    onSuccess: () => {
      setNotice("Confirmed. Lesson notes can use it now.");
      refresh();
    },
    onError: (error: unknown) => setFailure(describeFailure(error, "That could not be confirmed.")),
  });

  const remove = useMutation({
    mutationFn: (documentId: string) => staffDeleteCurriculum(documentId),
    onSuccess: () => {
      setNotice("Removed.");
      refresh();
    },
    onError: (error: unknown) =>
      setFailure(
        describeFailure(error, "That could not be removed. You can only remove what you uploaded."),
      ),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  // The list endpoint returns an envelope, not an array. Reading it as an
  // array is what crashed this screen on the first device build.
  const documentList = documents.data?.documents ?? [];
  const usage = documents.data?.usage ?? null;
  const busy = paste.isPending || upload.isPending;
  const targeted = selectedArm !== null && subjectId !== null;
  const canPaste = targeted && title.trim().length > 0 && content.trim().length > 0 && !busy;
  const canUpload = targeted && !busy;

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScreenHeader
          title="Curriculum"
          subtitle="Give the app your scheme of work, and lesson notes follow it instead of the topic alone."
        />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={styles.form}>
            <Body>Add a scheme of work</Body>

            <Label>Class</Label>
            <View style={styles.chips}>
              {arms.map((arm) => {
                const active = arm.id === armId;
                return (
                  <Pressable
                    key={arm.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setArmId(arm.id);
                      setSubjectId(null);
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: colors.primary,
                        backgroundColor: active ? colors.primary : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? colors.primaryForeground : colors.primary },
                      ]}
                    >
                      {arm.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {armId ? (
              <>
                <Label>Subject</Label>
                {subjects.length === 0 ? (
                  <Body muted>You teach no subject in that class.</Body>
                ) : (
                  <View style={styles.chips}>
                    {subjects.map((subject) => {
                      const active = subject.id === subjectId;
                      return (
                        <Pressable
                          key={subject.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => setSubjectId(subject.id)}
                          style={[
                            styles.chip,
                            {
                              borderColor: colors.primary,
                              backgroundColor: active ? colors.primary : "transparent",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              { color: active ? colors.primaryForeground : colors.primary },
                            ]}
                          >
                            {subject.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            ) : null}

            <Label>Title</Label>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. JSS2 Basic Science, first term"
              placeholderTextColor={colors.mutedForeground}
              maxLength={200}
              accessibilityLabel="Document title"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />

            <Label>Type or paste the scheme of work</Label>
            <TextInput
              value={content}
              onChangeText={setContent}
              multiline
              placeholder="Paste the weekly topics here."
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Scheme of work text"
              style={[
                styles.textarea,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />
            <Button
              title="Send this text"
              loading={paste.isPending}
              disabled={!canPaste}
              onPress={() => paste.mutate()}
            />

            {/* D26 — said before anyone tries, not discovered afterwards. */}
            <Notice tone="info">
              You can also attach a PDF or Word file, up to 10 MB. A photograph of a syllabus
              cannot be read — type or paste the words instead.
            </Notice>
            <Button
              title="Attach a PDF or Word file"
              variant="secondary"
              loading={upload.isPending}
              disabled={!canUpload}
              onPress={() => upload.mutate()}
            />
            {!targeted ? <Label>Choose a class and subject first.</Label> : null}
          </Card>

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          <Label>
            What your school has
            {usage ? ` — ${usage.documents} of ${usage.maxDocuments}` : ""}
          </Label>
          {usage && usage.documents >= usage.maxDocuments ? (
            <Notice tone="warning">
              Your school has reached its limit of {usage.maxDocuments} documents. Remove one
              before adding another.
            </Notice>
          ) : null}

          {documents.isPending && (
            <Skeleton lines={3} />
          )}

          {documents.isError && !documents.data && (
            <CenteredMessage>
              <Notice tone="danger">We couldn&apos;t load this. Try again shortly.</Notice>
              <Button
                title="Try again"
                variant="secondary"
                onPress={() => void documents.refetch()}
              />
            </CenteredMessage>
          )}

          {documents.data && documentList.length === 0 && (
            <EmptyState
              icon="library-outline"
              title="No scheme of work yet"
              body="Until one is added, lesson notes are written from the topic alone."
            />
          )}

          {documentList.map((document) => (
            <Card key={document.id} style={styles.docCard}>
              <View style={styles.docText}>
                <Body>{document.title}</Body>
                <Label>{describeStatus(document.status)}</Label>
                {document.status === "FAILED" && document.errorMessage ? (
                  <Label>{document.errorMessage}</Label>
                ) : null}
                {document.status === "READY" ? (
                  <Label>{document.chunkCount} sections</Label>
                ) : null}
              </View>
              {document.status === "AWAITING_REVIEW" ? (
                <Button
                  title="Confirm it"
                  loading={approve.isPending}
                  disabled={approve.isPending}
                  onPress={() => approve.mutate(document.id)}
                />
              ) : null}
              <Button
                title="Remove"
                variant="secondary"
                disabled={remove.isPending}
                onPress={() => remove.mutate(document.id)}
              />
            </Card>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingVertical: spacing.md },
  form: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  textarea: {
    minHeight: 140,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  docCard: { gap: spacing.sm },
  docText: { gap: spacing.xs },
});
