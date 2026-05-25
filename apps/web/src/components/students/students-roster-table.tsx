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

// `current class` is intentionally NOT a column — class membership lives in
// per-term Enrollment which doesn't land until slice 9. The detail page will
// surface it the same way once enrollments are in.
export function StudentsRosterTable({ students }: Props) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 font-medium">Admission #</th>
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
