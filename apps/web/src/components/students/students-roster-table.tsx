"use client";

import { Eye } from "lucide-react";
import Link from "next/link";

import type { StudentDto } from "@school-kit/types";

import { StudentAvatar } from "@/components/students/student-avatar";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { Button } from "@/components/ui/button";

interface Props {
  students: StudentDto[];
}

// Slice 9: the Class column is now wired. The roster API populates
// `currentEnrollment` on each StudentDto via a single batched join (see
// the slice-9 cp1 "no N+1" spec). Renders the level name + arm name
// when present, or "—" when the student has no current-term enrollment
// (admitted-not-yet-enrolled is a normal state).
export function StudentsRosterTable({ students }: Props) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Admission #</th>
            <th className="px-3 py-2 font-medium">Class</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="px-3 py-2">
                <div className="flex items-center gap-3">
                  <StudentAvatar
                    firstName={s.firstName}
                    lastName={s.lastName}
                    photoUrl={s.photoUrl}
                    size="sm"
                  />
                  <span className="font-medium">
                    {s.lastName}, {s.firstName}
                    {s.middleName ? ` ${s.middleName.charAt(0)}.` : ""}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {s.admissionNumber}
              </td>
              <td className="px-3 py-2 text-xs">
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
              </td>
              <td className="px-3 py-2">
                <StudentStatusBadge status={s.status} />
              </td>
              <td className="px-3 py-2 text-right">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-7"
                >
                  <Link href={`/students/${s.id}`}>
                    <Eye className="mr-1 h-3 w-3" />
                    View
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
