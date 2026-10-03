import {
  QUESTION_MARKS_MAX,
  QUESTION_OPTIONS_MAX,
  findQuestionContentError,
  type QuestionDifficulty,
  type QuestionDto,
  type QuestionType,
  type UpdateQuestionInput,
} from "@school-kit/types";

// The question editor's form state, and its translation to and from the API.
// Strings throughout (empty = not entered), coerced only at submit — the
// FORM-CLASS discipline the gradebook uses. The type rules come from the same
// function the API enforces (findQuestionContentError), so the form refuses
// exactly what the server would.

export interface QuestionFormValues {
  topic: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  text: string;
  marks: string;
  answerGuide: string;
  /** Multiple choice only. Index of the correct option, or -1 for none chosen. */
  options: string[];
  correctIndex: number;
}

export const OPTION_LETTERS = ["A", "B", "C", "D", "E"] as const;

export function emptyQuestionForm(topic = ""): QuestionFormValues {
  return {
    topic,
    type: "MULTIPLE_CHOICE",
    difficulty: "MEDIUM",
    text: "",
    marks: "1",
    answerGuide: "",
    options: ["", "", "", ""],
    correctIndex: -1,
  };
}

export function questionToForm(q: QuestionDto): QuestionFormValues {
  const options = q.options.map((o) => o.text);
  return {
    topic: q.topic,
    type: q.type,
    difficulty: q.difficulty,
    text: q.text,
    marks: String(q.marks),
    answerGuide: q.answerGuide ?? "",
    options: q.type === "MULTIPLE_CHOICE" ? options : ["", "", "", ""],
    correctIndex: q.options.findIndex((o) => o.isCorrect),
  };
}

export type QuestionFormResult =
  | { ok: true; input: UpdateQuestionInput }
  | { ok: false; field: "topic" | "text" | "marks" | "options" | "answerGuide"; message: string };

/** Validate and convert. The first problem is returned, in words to show beside the field. */
export function formToInput(form: QuestionFormValues): QuestionFormResult {
  if (!form.topic.trim()) return { ok: false, field: "topic", message: "Give the topic." };
  if (!form.text.trim()) return { ok: false, field: "text", message: "Write the question." };
  const marks = form.marks.trim();
  if (!/^\d+$/.test(marks) || Number(marks) < 1 || Number(marks) > QUESTION_MARKS_MAX) {
    return { ok: false, field: "marks", message: `Marks must be a whole number from 1 to ${QUESTION_MARKS_MAX}.` };
  }
  const options =
    form.type === "MULTIPLE_CHOICE"
      ? form.options.map((text, i) => ({ text: text.trim(), isCorrect: i === form.correctIndex }))
      : [];
  const answerGuide = form.answerGuide.trim() || null;
  const problem = findQuestionContentError({ type: form.type, answerGuide, options });
  if (problem) return { ok: false, field: problem.path, message: problem.message };
  return {
    ok: true,
    input: {
      topic: form.topic.trim(),
      type: form.type,
      difficulty: form.difficulty,
      text: form.text.trim(),
      marks: Number(marks),
      answerGuide,
      options,
    },
  };
}

/** Add an empty option, up to the maximum. */
export function addOption(form: QuestionFormValues): QuestionFormValues {
  if (form.options.length >= QUESTION_OPTIONS_MAX) return form;
  return { ...form, options: [...form.options, ""] };
}

/** Remove an option, keeping the correct-answer mark on the same option text. */
export function removeOption(form: QuestionFormValues, index: number): QuestionFormValues {
  const options = form.options.filter((_, i) => i !== index);
  const correctIndex =
    form.correctIndex === index ? -1 : form.correctIndex > index ? form.correctIndex - 1 : form.correctIndex;
  return { ...form, options, correctIndex };
}
