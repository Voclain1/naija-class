import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CALENDAR_CATEGORY_LABELS,
  SCHOOL_EVENT_CATEGORIES,
  type SchoolEventCategory,
} from "@school-kit/types";

import {
  staffCreateSchoolEvent,
  staffDeleteSchoolEvent,
  staffSchoolEvents,
  staffUpdateSchoolEvent,
} from "../../../src/lib/api/staff-schedule";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import {
  buildCreateEventInput,
  buildUpdateEventInput,
  calendarAbilities,
  emptyEventForm,
  eventFormFrom,
  validateEventForm,
  type EventFormErrors,
  type EventFormValues,
} from "../../../src/lib/staff/event-form";
import { spacing } from "../../../src/theme/tokens";
import { Button, Card, CenteredMessage, Label, Notice, Screen } from "../../../src/components/ui";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { ChoiceChips, DateBoxes, TextField } from "../../../src/components/form";

// CP9a — add, edit or remove a school event.
//
// Opened two ways from the calendar: "Add event" (with the day the admin had
// tapped as the start), or "Edit event" on one of the school's own entries.
// National holidays and term dates never reach here — calendar-view only
// offers Edit on entries event-form.ts recognises as the school's.
//
// Editing reads the event afresh from /calendar/events rather than trusting
// the merged calendar row it was opened from: the edit is then built against
// what the server holds now, and a change made on the website a minute ago is
// not silently overwritten with the phone's older copy.

const CATEGORY_OPTIONS = SCHOOL_EVENT_CATEGORIES.map((value) => ({
  value,
  label: CALENDAR_CATEGORY_LABELS[value],
}));

function describeFailure(error: unknown, action: string): string {
  if (error instanceof ApiNetworkError) {
    return `Your phone couldn't reach the server, so the event was not ${action}. Try again when you have signal.`;
  }
  if (error instanceof ApiError) {
    if (error.status === 404) return "This event no longer exists — someone may have removed it.";
    if (error.status === 403) return "Your account can't change the school calendar.";
    return error.message || `The event was not ${action}.`;
  }
  return `The event was not ${action}.`;
}

export default function SchoolEventScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string; from?: string; to?: string; date?: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const abilities = calendarAbilities(staff?.roles, staff?.permissions ?? []);

  const editingId = typeof params.id === "string" && params.id !== "" ? params.id : null;
  const from = typeof params.from === "string" ? params.from : "";
  const to = typeof params.to === "string" ? params.to : "";

  const existing = useQuery({
    queryKey: queryKeys.staffSchoolEvents(schoolId, userId, from, to),
    queryFn: () => staffSchoolEvents({ from, to }),
    enabled: authed && editingId !== null && from !== "" && to !== "" && schoolId !== "",
    staleTime: 0,
  });
  const original = useMemo(
    () => (existing.data ?? []).find((event) => event.id === editingId) ?? null,
    [existing.data, editingId],
  );

  const [values, setValues] = useState<EventFormValues>(() =>
    emptyEventForm(typeof params.date === "string" ? params.date : null),
  );
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fill the form once, when the event arrives — never again, or a background
  // refetch would wipe what the admin is typing.
  useEffect(() => {
    if (original && loadedId !== original.id) {
      setValues(eventFormFrom(original));
      setLoadedId(original.id);
    }
  }, [original, loadedId]);

  function finish(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.staffCalendarAll(schoolId, userId) });
    void queryClient.invalidateQueries({
      queryKey: ["staff", schoolId, userId, "calendar-events"],
    });
    router.back();
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editingId && original) {
        const patch = buildUpdateEventInput(original, values);
        if (patch === null) return "unchanged" as const;
        await staffUpdateSchoolEvent(editingId, patch);
        return "saved" as const;
      }
      await staffCreateSchoolEvent(buildCreateEventInput(values));
      return "saved" as const;
    },
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (result) => {
      if (result === "unchanged") {
        setNotice("Nothing has changed, so there was nothing to save.");
        return;
      }
      finish();
    },
    onError: (error) => setFailure(describeFailure(error, editingId ? "saved" : "added")),
  });

  const remove = useMutation({
    mutationFn: () => staffDeleteSchoolEvent(editingId as string),
    onMutate: () => setFailure(null),
    onSuccess: finish,
    onError: (error) => setFailure(describeFailure(error, "removed")),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />;
  const allowed = editingId ? abilities.update || abilities.remove : abilities.create;

  if (!allowed) {
    return (
      <Screen>
        {header}
        <Notice tone="info">The school calendar is changed by owners and administrators.</Notice>
      </Screen>
    );
  }

  if (editingId && existing.isPending) {
    return (
      <Screen>
        {header}
        <Skeleton lines={6} />
      </Screen>
    );
  }

  if (editingId && !original) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          <Notice tone="danger">
            {existing.isError
              ? "We couldn't load this event. Try again shortly."
              : "This event no longer exists — someone may have removed it."}
          </Notice>
          <Button title="Try again" variant="secondary" onPress={() => void existing.refetch()} />
        </CenteredMessage>
      </Screen>
    );
  }

  const busy = save.isPending || remove.isPending;

  function submit(): void {
    const found = validateEventForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate();
  }

  function confirmRemove(): void {
    Alert.alert(
      "Remove this event?",
      `"${values.title.trim() || "This event"}" will be taken off the calendar for staff, parents and students.`,
      [
        { text: "Keep it", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
      ],
    );
  }

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            title={editingId ? "Edit event" : "Add an event"}
            subtitle="Everyone sees it — staff, parents and students."
          />

          <Card style={styles.card}>
            <TextField
              label="Name"
              value={values.title}
              onChangeText={(title) => setValues((v) => ({ ...v, title }))}
              error={errors.title}
              placeholder="e.g. Inter-house sports"
              autoCapitalize="sentences"
            />
            <ChoiceChips<SchoolEventCategory>
              label="Kind of event"
              options={CATEGORY_OPTIONS}
              value={values.category}
              onChange={(category) => setValues((v) => ({ ...v, category }))}
              error={errors.category}
            />
            <DateBoxes
              label="Starts"
              value={{ day: values.startDay, month: values.startMonth, year: values.startYear }}
              onChange={(d) => setValues((v) => ({ ...v, startDay: d.day, startMonth: d.month, startYear: d.year }))}
              error={errors.startDate}
            />
            <DateBoxes
              label="Ends (leave blank for a one-day event)"
              value={{ day: values.endDay, month: values.endMonth, year: values.endYear }}
              onChange={(d) => setValues((v) => ({ ...v, endDay: d.day, endMonth: d.month, endYear: d.year }))}
              error={errors.endDate}
            />
            <TextField
              label="Note (optional)"
              value={values.description}
              onChangeText={(description) => setValues((v) => ({ ...v, description }))}
              error={errors.description}
              multiline
              autoCapitalize="sentences"
            />
          </Card>

          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          {notice ? <Notice tone="info">{notice}</Notice> : null}

          {editingId ? (
            abilities.update ? (
              <Button title="Save changes" loading={save.isPending} disabled={busy} onPress={submit} />
            ) : null
          ) : (
            <Button title="Add to calendar" loading={save.isPending} disabled={busy} onPress={submit} />
          )}
          {editingId && abilities.remove ? (
            <Button title="Remove event" variant="secondary" loading={remove.isPending} disabled={busy} onPress={confirmRemove} />
          ) : null}
          {editingId && !abilities.update ? <Label>Your account can remove this event but not edit it.</Label> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.md },
});
