"use client";

import { Eye } from "lucide-react";
import Link from "next/link";

import type { StudentDto } from "@school-kit/types";

import { StudentAvatar } from "@/components/students/student-avatar";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Admission #</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Status</TableHead>
            <TableHead aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
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
                <StudentStatusBadge status={s.status} />
              </TableCell>
              <TableCell className="text-right">
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
