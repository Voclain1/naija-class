import { useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  formatCalendarRange,
  RSVP_ANSWER_LABELS,
  RSVP_ANSWERS,
  RSVP_MAX_ATTENDING,
  type CalendarEntryDto,
  type FamilyRsvpDto,
  type RsvpAnswer,
} from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { guardianAnswerRsvp } from "../lib/api/portal";
import { spacing } from "../theme/tokens";
import { ChoiceChips } from "./form";
import { Body, Caption, Card, Heading, Notice } from "./ui";

// Phase 9 / CP10.1 — an event that asks this family to reply
// (docs/modules/phase-9.md §19.2): Yes, No or Maybe, and how many are coming
// when asked. Changeable until replies close.

export function RsvpCard({ entry, onSaved }: { entry: CalendarEntryDto & { rsvp: FamilyRsvpDto }; onSaved: () => void }) {
  const [rsvp, setRsvp] = useState(entry.rsvp);
  const [attending, setAttending] = useState(String(entry.rsvp.attending ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(answer: RsvpAnswer) {
    setBusy(true);
    setError(null);
    try {
      setRsvp(await guardianAnswerRsvp(entry.id.replace(/^school:/, ""), { answer, attending: rsvp.askCount && answer !== "NO" ? Number(attending) : null }));
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your reply was not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Heading>{entry.title}</Heading>
      <Caption>
        {formatCalendarRange(entry.startDate, entry.endDate)}
        {rsvp.deadline ? ` · reply by ${formatCalendarRange(rsvp.deadline, rsvp.deadline)}` : ""}
      </Caption>
      {rsvp.open ? (
        <View style={styles.gap}>
          {rsvp.askCount ? (
            <ChoiceChips
              label="How many people will come?"
              options={Array.from({ length: RSVP_MAX_ATTENDING }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
              value={attending}
              onChange={setAttending}
            />
          ) : null}
          <ChoiceChips
            label="Your answer"
            options={RSVP_ANSWERS.map((a) => ({ value: a, label: RSVP_ANSWER_LABELS[a] }))}
            value={rsvp.answer}
            onChange={(a) => !busy && void send(a)}
          />
          {rsvp.answer ? (
            <Caption>{`Saved: ${RSVP_ANSWER_LABELS[rsvp.answer]}${rsvp.attending ? `, ${rsvp.attending} coming` : ""}. You can change it until replies close.`}</Caption>
          ) : null}
        </View>
      ) : (
        <Body>
          {rsvp.answer
            ? `Replies have closed. Your answer: ${RSVP_ANSWER_LABELS[rsvp.answer]}${rsvp.attending ? `, ${rsvp.attending} coming` : ""}.`
            : "Replies have closed. You did not reply."}
        </Body>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
});
