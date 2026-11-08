import { useState } from "react";
import { View } from "react-native";
import {
  AFFECTIVE_TRAITS,
  PSYCHOMOTOR_SKILLS,
  REPORT_RATING_KEY,
  readReportProfile,
  reportProfileSchema,
  type ReportCardDetailDto,
  type ReportProfile,
} from "@school-kit/types";
import {
  staffGetReportCard,
  staffSaveReportProfile,
} from "../lib/api/staff-report-cards";
import { spacing } from "../theme/tokens";
import { ChoiceChips, DateBoxes, TextField, type DateBoxValues } from "./form";
import { Body, Button, Label, Notice } from "./ui";

/** Load per child on demand; the server remains the authority on role and workflow state. */
export function StaffReportProfile({ id }: { id: string }) {
  const [detail, setDetail] = useState<ReportCardDetailDto | null>(null);
  const [profile, setProfile] = useState<ReportProfile>(() =>
    readReportProfile(null),
  );
  const [date, setDate] = useState<DateBoxValues>({
    day: "",
    month: "",
    year: "",
  });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const editable =
    detail?.reportCard.status === "DRAFT" ||
    detail?.reportCard.status === "SUBJECT_REVIEWED";
  async function load() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await staffGetReportCard(id);
      const p = readReportProfile(data.reportCard.reportProfile);
      setDetail(data);
      setProfile(p);
      const parts = p.nextTermDate?.split("-");
      setDate(
        parts
          ? { year: parts[0] ?? "", month: parts[1] ?? "", day: parts[2] ?? "" }
          : { day: "", month: "", year: "" },
      );
      setOpen(true);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not load report details.",
      );
    } finally {
      setBusy(false);
    }
  }
  function change<K extends keyof ReportProfile>(
    key: K,
    value: ReportProfile[K],
  ) {
    setProfile((p) => ({ ...p, [key]: value }));
  }
  async function save() {
    const hasDate = date.year || date.month || date.day;
    const parsed = reportProfileSchema.safeParse({
      ...profile,
      customFields: profile.customFields.filter((f) =>
        detail?.customFieldDefinitions?.some((d) => d.key === f.key),
      ),
      nextTermDate: hasDate
        ? `${date.year}-${date.month.padStart(2, "0")}-${date.day.padStart(2, "0")}`
        : null,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the report details.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const card = await staffSaveReportProfile(id, parsed.data);
      setDetail((d) => (d ? { ...d, reportCard: card } : d));
      setProfile(readReportProfile(card.reportProfile));
      setMessage("Report details saved.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not save report details.",
      );
    } finally {
      setBusy(false);
    }
  }
  const defs = detail?.customFieldDefinitions ?? [];
  return (
    <View style={{ gap: spacing.sm }}>
      <Button
        title={open ? "Close report details" : "Development & report details"}
        variant="secondary"
        disabled={busy}
        onPress={() => {
          if (open) setOpen(false);
          else void load();
        }}
      />
      {message && <Notice tone="info">{message}</Notice>}
      {open && detail && (
        <View pointerEvents={busy ? "none" : "auto"} style={{ gap: spacing.md }}>
          <Body muted>
            Save observations before the class is sent for approval. Unrated areas show “Not recorded”.
          </Body>
          {editable ? (
            <>
              <ChoiceChips
                label="Report level"
                value={profile.level}
                options={[
                  { value: "NURSERY", label: "Nursery" },
                  { value: "PRIMARY", label: "Primary" },
                  { value: "SECONDARY", label: "Secondary" },
                ]}
                onChange={(v) => change("level", v)}
              />
              <DateBoxes
                label="Next term begins"
                value={date}
                onChange={setDate}
              />
              <TextField
                label="Form teacher’s name"
                value={profile.teacherName}
                maxLength={120}
                onChangeText={(v) => change("teacherName", v)}
              />
              <TextField
                label={
                  profile.level === "SECONDARY"
                    ? "Principal’s name"
                    : "Headteacher’s name"
                }
                value={profile.headName}
                maxLength={120}
                onChangeText={(v) => change("headName", v)}
              />
            </>
          ) : (
            <Body>
              Locked after form review. Next term:{" "}
              {profile.nextTermDate ?? "Not recorded"}
            </Body>
          )}
          <Body muted>{REPORT_RATING_KEY}</Body>
          {(
            [
              ["affective", "Character & attitude", AFFECTIVE_TRAITS],
              ["psychomotor", "Practical skills", PSYCHOMOTOR_SKILLS],
            ] as const
          ).map(([key, title, traits]) => (
            <View key={key} style={{ gap: spacing.sm }}>
              <Label>{title}</Label>
              {traits.map((trait) =>
                editable ? (
                  <ChoiceChips
                    key={trait}
                    label={trait}
                    value={String(profile[key][trait] ?? "")}
                    options={[
                      { value: "", label: "Unrated" },
                      ...[5, 4, 3, 2, 1].map((v) => ({
                        value: String(v),
                        label: String(v),
                      })),
                    ]}
                    onChange={(v) =>
                      change(key, {
                        ...profile[key],
                        [trait]: v ? Number(v) : null,
                      })
                    }
                  />
                ) : (
                  <Body key={trait}>
                    {trait}: {profile[key][trait] ?? "Not recorded"}
                  </Body>
                ),
              )}
            </View>
          ))}
          {(editable ? defs : profile.customFields).map((field) =>
            editable ? (
              <TextField
                key={field.key}
                label={field.label}
                maxLength={300}
                value={
                  profile.customFields.find((f) => f.key === field.key)
                    ?.value ?? ""
                }
                onChangeText={(v) =>
                  change("customFields", [
                    ...profile.customFields.filter(
                      (f) =>
                        f.key !== field.key &&
                        defs.some((d) => d.key === f.key),
                    ),
                    { ...field, value: v },
                  ])
                }
              />
            ) : (
              <Body key={field.key}>
                {field.label}:{" "}
                {profile.customFields.find((f) => f.key === field.key)?.value ||
                  "Not recorded"}
              </Body>
            ),
          )}
          {editable && (
            <Button
              title="Save report details"
              loading={busy}
              disabled={busy}
              onPress={() => void save()}
            />
          )}
        </View>
      )}
    </View>
  );
}
