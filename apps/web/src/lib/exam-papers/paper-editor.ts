import type { ExamPaperDto, QuestionDto, SaveExamPaperInput } from "@school-kit/types";

// The exam paper editor's working copy, and the pure moves made on it. The
// page holds one of these, edits it locally, and saves the whole thing with
// one PUT (the API replaces the structure). Totals here are for the screen
// only; the paper's real total is the API's, read back after saving.

export interface EditorSection {
  /** Stable client-side key for React lists; not persisted. */
  key: string;
  title: string;
  instructions: string;
  questions: QuestionDto[];
}

export interface PaperEditorState {
  title: string;
  durationMinutes: string;
  instructions: string;
  componentId: string;
  versionCount: number;
  sections: EditorSection[];
}

let keySeq = 0;
const nextKey = () => `s${(keySeq += 1)}`;

export function editorFromPaper(paper: ExamPaperDto): PaperEditorState {
  return {
    title: paper.title,
    durationMinutes: String(paper.durationMinutes),
    instructions: paper.instructions ?? "",
    componentId: paper.componentId ?? "",
    versionCount: paper.versionCount,
    sections: paper.sections.map((s) => ({ key: nextKey(), title: s.title, instructions: s.instructions ?? "", questions: s.questions })),
  };
}

export type SaveResult = { ok: true; input: SaveExamPaperInput } | { ok: false; message: string };

export function editorToInput(state: PaperEditorState): SaveResult {
  if (!state.title.trim()) return { ok: false, message: "Give the paper a title." };
  const minutes = state.durationMinutes.trim();
  if (!/^\d+$/.test(minutes) || Number(minutes) < 5 || Number(minutes) > 600) {
    return { ok: false, message: "Time allowed must be a whole number of minutes, from 5 to 600." };
  }
  if (state.sections.length === 0) return { ok: false, message: "A paper needs at least one section." };
  const untitled = state.sections.findIndex((s) => !s.title.trim());
  if (untitled >= 0) return { ok: false, message: `Give section ${untitled + 1} a title.` };
  return {
    ok: true,
    input: {
      title: state.title.trim(),
      durationMinutes: Number(minutes),
      instructions: state.instructions.trim() || null,
      componentId: state.componentId || null,
      versionCount: state.versionCount,
      sections: state.sections.map((s) => ({
        title: s.title.trim(),
        instructions: s.instructions.trim() || null,
        questionIds: s.questions.map((q) => q.id),
      })),
    },
  };
}

/** Compare what would be saved, not object identity. */
export function isEditorDirty(state: PaperEditorState, saved: PaperEditorState): boolean {
  const a = editorToInput(state);
  const b = editorToInput(saved);
  if (!a.ok || !b.ok) return a.ok !== b.ok || JSON.stringify(state) !== JSON.stringify(saved);
  return JSON.stringify(a.input) !== JSON.stringify(b.input);
}

/** Every question id on the paper — to keep the bank picker and draws from repeating one. */
export function usedQuestionIds(state: PaperEditorState): string[] {
  return state.sections.flatMap((s) => s.questions.map((q) => q.id));
}

/** Add questions to a section, skipping any already on the paper. */
export function addQuestions(state: PaperEditorState, sectionIndex: number, questions: QuestionDto[]): PaperEditorState {
  const used = new Set(usedQuestionIds(state));
  const fresh = questions.filter((q) => !used.has(q.id) && (used.add(q.id), true));
  return {
    ...state,
    sections: state.sections.map((s, i) => (i === sectionIndex ? { ...s, questions: [...s.questions, ...fresh] } : s)),
  };
}

export function removeQuestion(state: PaperEditorState, sectionIndex: number, questionIndex: number): PaperEditorState {
  return {
    ...state,
    sections: state.sections.map((s, i) =>
      i === sectionIndex ? { ...s, questions: s.questions.filter((_, j) => j !== questionIndex) } : s,
    ),
  };
}

/** Move a question up (-1) or down (+1) within its section. No-op at the ends. */
export function moveQuestion(state: PaperEditorState, sectionIndex: number, questionIndex: number, delta: -1 | 1): PaperEditorState {
  const section = state.sections[sectionIndex];
  const target = questionIndex + delta;
  if (!section || target < 0 || target >= section.questions.length) return state;
  const questions = [...section.questions];
  [questions[questionIndex], questions[target]] = [questions[target]!, questions[questionIndex]!];
  return { ...state, sections: state.sections.map((s, i) => (i === sectionIndex ? { ...s, questions } : s)) };
}

export function addSection(state: PaperEditorState): PaperEditorState {
  const letter = String.fromCharCode(65 + state.sections.length);
  return { ...state, sections: [...state.sections, { key: nextKey(), title: `Section ${letter}`, instructions: "", questions: [] }] };
}

export function removeSection(state: PaperEditorState, sectionIndex: number): PaperEditorState {
  return { ...state, sections: state.sections.filter((_, i) => i !== sectionIndex) };
}

/** Running marks for the screen: per section, and in all. */
export function editorMarks(state: PaperEditorState): { sections: number[]; total: number } {
  const sections = state.sections.map((s) => s.questions.reduce((n, q) => n + q.marks, 0));
  return { sections, total: sections.reduce((a, b) => a + b, 0) };
}
