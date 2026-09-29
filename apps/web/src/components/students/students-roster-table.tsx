"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { StudentDto } from "@school-kit/types";

import { StudentAvatar } from "@/components/students/student-avatar";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  students: StudentDto[];
}

// Slice 9: the Class column is now wired. The roster API populates
// `currentEnrollment` on each StudentDto via a single batched join (see
// the slice-9 cp1 "no N+1" spec). Renders the level name + arm name
// when present, or "—" when the student has no current-term enrollment
// (admitted-not-yet-enrolled is a normal state).
// The row IS the link (look-and-feel.md). A "View" button repeated on every
// row put fifty identical controls down a column that carried no information,
// and at a real roster size that column is the loudest thing on the page.
//
// Accessibility is why the NAME is the anchor rather than the row: a clickable
// <tr> is not focusable and cannot be reached by keyboard, so the row click is
// a mouse convenience layered on top of a real link, never the only way in.
// The link text is the student's name, which also fixes what the old button's
// comment worked around — a screen reader listing links used to hear "View"
// fifty times with nothing to tell the children apart.
export function StudentsRosterTable({ students }: Props) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Admission #</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((s) => (
            <TableRow
              key={s.id}
              onClick={() => router.push(`/students/${s.id}`)}
              className="cursor-pointer"
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <StudentAvatar
                    firstName={s.firstName}
                    lastName={s.lastName}
                    photoUrl={s.photoUrl}
                    size="sm"
                  />
                  <Link
                    href={`/students/${s.id}`}
                    className="font-medium hover:underline"
                    // The row's onClick would fire too and push the same route
                    // twice; let the anchor do its own job.
                    onClick={(event) => event.stopPropagation()}
                  >
                    {s.lastName}, {s.firstName}
                    {s.middleName ? ` ${s.middleName.charAt(0)}.` : ""}
                  </Link>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {s.admissionNumber}
              </TableCell>
              <TableCell className="text-xs">
                {s.currentEnrollment ? (
                  <span>
                    <span className="font-medium">
                      {s.currentEnrollment.classArm.classLevel.name}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · {s.currentEnrollment.classArm.name}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {/* Only the EXCEPTIONS are drawn. On a normal roster every
                    student is active, so a badge on every row is a column of
                    identical green pills competing with the names beside them.
                    Silence for the norm makes a withdrawal or a transfer
                    impossible to miss — which is the only reason to look at
                    this column at all. */}
                {s.status === "ACTIVE" ? (
                  <span className="sr-only">Active</span>
                ) : (
                  <StudentStatusBadge status={s.status} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
