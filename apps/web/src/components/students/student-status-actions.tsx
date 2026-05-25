"use client";

import { GraduationCap, Loader2, LogOut, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { StudentDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  graduateStudent,
  reactivateStudent,
  withdrawStudent,
} from "@/lib/students/students-api";

interface Props {
  student: StudentDto;
  onChanged: (next: StudentDto) => void;
}

type Action = "withdraw" | "graduate" | "reactivate" | null;

// Inline confirm dialog (Tailwind overlay + a Tailwind card + Escape handler)
// — matches the slice-3 pattern. Each transition reuses the same dialog
// shell with different copy + handler.
export function StudentStatusActions({ student, onChanged }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [eventDate, setEventDate] = useState(""); // YYYY-MM-DD; blank = "now"
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!action) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) closeDialog();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [action, submitting]);

  function closeDialog() {
    setAction(null);
    setReason("");
    setEventDate("");
  }

  async function onConfirm() {
    if (!action) return;
    setSubmitting(true);
    try {
      const trimmedReason = reason.trim();
      const reasonField = trimmedReason === "" ? undefined : trimmedReason;
      const eventDateValue =
        eventDate === "" ? undefined : new Date(eventDate);

      let next: StudentDto;
      if (action === "withdraw") {
        next = await withdrawStudent(student.id, {
          reason: reasonField,
          withdrawnAt: eventDateValue,
        });
        toast.success("Student withdrawn.");
      } else if (action === "graduate") {
        next = await graduateStudent(student.id, {
          reason: reasonField,
          graduatedAt: eventDateValue,
        });
        toast.success("Student graduated.");
      } else {
        next = await reactivateStudent(student.id, {
          reason: reasonField,
        });
        toast.success("Student reactivated.");
      }
      onChanged(next);
      closeDialog();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        // The cp2 service surfaces ALREADY_WITHDRAWN, ALREADY_GRADUATED,
        // ALREADY_ACTIVE, and INVALID_TRANSITION as 409s with clear
        // messages — bubble them straight to a toast.
        toast.error(error.message);
      } else {
        toast.error("Could not reach the server. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isTerminal =
    student.status === "WITHDRAWN" || student.status === "GRADUATED";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!isTerminal && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAction("withdraw")}
              className="text-rose-700 hover:bg-rose-50"
            >
              <LogOut className="mr-1 h-4 w-4" />
              Withdraw
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAction("graduate")}
              className="text-sky-700 hover:bg-sky-50"
            >
              <GraduationCap className="mr-1 h-4 w-4" />
              Graduate
            </Button>
          </>
        )}
        {student.status !== "ACTIVE" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAction("reactivate")}
            className="text-emerald-700 hover:bg-emerald-50"
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            Reactivate
          </Button>
        )}
      </div>

      {action && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="status-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) closeDialog();
          }}
        >
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2
                  id="status-dialog-title"
                  className="text-lg font-semibold"
                >
                  {action === "withdraw" && "Withdraw student"}
                  {action === "graduate" && "Graduate student"}
                  {action === "reactivate" && "Reactivate student"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {action === "withdraw" &&
                    `Mark ${student.firstName} ${student.lastName} as withdrawn. They will no longer appear in the active roster.`}
                  {action === "graduate" &&
                    `Mark ${student.firstName} ${student.lastName} as graduated. They will move to the graduated cohort.`}
                  {action === "reactivate" &&
                    `Return ${student.firstName} ${student.lastName} to the active roster. Any withdrawal or graduation date will be cleared.`}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeDialog}
                disabled={submitting}
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              {action !== "reactivate" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="status-eventDate">
                    {action === "withdraw" ? "Withdrawal date" : "Graduation date"}{" "}
                    (optional)
                  </Label>
                  <Input
                    id="status-eventDate"
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use today.
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <Label htmlFor="status-reason">Reason (optional)</Label>
                <textarea
                  id="status-reason"
                  rows={3}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground">
                  Logged to the audit trail. Up to 500 characters.
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={submitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onConfirm}
                disabled={submitting}
                className="flex-1"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting
                  ? "Saving…"
                  : action === "withdraw"
                    ? "Withdraw"
                    : action === "graduate"
                      ? "Graduate"
                      : "Reactivate"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
