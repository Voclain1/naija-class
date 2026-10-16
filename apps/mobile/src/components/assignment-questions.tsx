import { Pressable, StyleSheet, TextInput, View } from "react-native";
import {
  ASSIGNMENT_LIMITS,
  optionLetter,
  type AnswerResultDto,
  type MyAssignmentQuestionDto,
} from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { Body, Caption } from "./ui";

// Phase 9 / CP4.3 — questions on collected work (docs/modules/phase-9.md §11
// CP4-D6). `QuestionInputs` is the student's answering form; `AnswerList`
// shows an attempt's answers, with "Right" or "Wrong" only when the caller has
// it (staff always; the student once marks are released). Right or wrong is
// said in words as well as by the tint, and the right answer itself never
// reaches the student.

type Question = Pick<MyAssignmentQuestionDto, "id" | "number" | "type" | "text" | "marks" | "options">;
export type AnswerMap = Record<string, number | string>;

export function QuestionInputs({
  questions,
  answers,
  onChange,
}: {
  questions: readonly Question[];
  answers: AnswerMap;
  onChange: (next: AnswerMap) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {questions.map((q) => (
        <View key={q.id} style={styles.question}>
          <Body>
            {q.number}. {q.text}
          </Body>
          <Caption>
            {q.marks} mark{q.marks === 1 ? "" : "s"}
          </Caption>
          {q.type === "MULTIPLE_CHOICE" ? (
            <View accessibilityRole="radiogroup" style={styles.options}>
              {(q.options ?? []).map((o, i) => {
                const chosen = answers[q.id] === i;
                return (
                  <Pressable
                    key={i}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen }}
                    accessibilityLabel={`${optionLetter(i)}. ${o}`}
                    onPress={() => onChange({ ...answers, [q.id]: i })}
                    style={[
                      styles.option,
                      { borderColor: colors.border, backgroundColor: chosen ? `${colors.primary}22` : colors.background },
                    ]}
                  >
                    <Body>
                      {optionLetter(i)}. {o}
                      {chosen ? "  (your answer)" : ""}
                    </Body>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
              onChangeText={(text) => {
                const next = { ...answers };
                if (text === "") delete next[q.id];
                else next[q.id] = text;
                onChange(next);
              }}
              maxLength={ASSIGNMENT_LIMITS.answerText}
              accessibilityLabel={`Answer to question ${q.number}`}
              placeholder="Your answer"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

export function AnswerList({
  questions,
  answers,
}: {
  questions: readonly Pick<Question, "id" | "text" | "options">[];
  answers: readonly AnswerResultDto[];
}) {
  const { colors } = useTheme();
  if (answers.length === 0) return null;
  const byId = new Map(questions.map((q) => [q.id, q]));
  return (
    <View style={styles.list}>
      {answers.map((a) => {
        const q = byId.get(a.questionId);
        const given =
          a.answer === null ? "Left blank" : typeof a.answer === "number" ? `${optionLetter(a.answer)}. ${q?.options?.[a.answer] ?? ""}` : a.answer;
        const tint =
          a.correct === null ? `${colors.mutedForeground}14` : a.correct ? `${colors.primary}1F` : `${colors.warning}33`;
        return (
          <View key={a.questionId} style={[styles.answer, { backgroundColor: tint }]}>
            <Body>
              {a.number}. {q?.text ?? ""}
            </Body>
            <Caption>
              {a.correct === null ? "" : a.correct ? "Right: " : "Wrong: "}
              {given}
            </Caption>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  question: { gap: spacing.xs },
  options: { gap: spacing.xs },
  option: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  answer: { gap: 2, padding: spacing.sm, borderRadius: radii.sm },
});
