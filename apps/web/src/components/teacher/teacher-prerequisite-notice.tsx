import { Info } from "lucide-react";

// The teacher's half of the F-25 fix (docs/deferred-archive.md, "teacher
// screens still have no prerequisite messaging"). PrerequisiteNotice is for
// owners and admins: it names a setup step and links to it. A teacher cannot
// take that step, so this says what is missing, that it affects them, and who
// can fix it, with no button that would only 403.
//
// Built from the teacher's own scope (GET /teacher-scope/me), never from the
// school's setup state, so it says nothing about configuration outside the
// teacher's classes.
export function TeacherPrerequisiteNotice({
  title,
  detail,
  testId,
}: {
  title: string;
  detail: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex gap-3 rounded-md border border-secondary/50 bg-secondary/10 px-4 py-3"
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
