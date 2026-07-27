"use client";

import { Check, Edit, Trash2 } from "lucide-react";
import Link from "next/link";

import type { AcademicYearDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  years: AcademicYearDto[];
  onEdit: (year: AcademicYearDto) => void;
  onSetCurrent: (year: AcademicYearDto) => void;
  onDelete: (year: AcademicYearDto) => void;
}

function fmtDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString();
}

export function AcademicYearsTable({ years, onEdit, onSetCurrent, onDelete }: Props) {
  if (years.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No academic years yet. Add one to get started.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Starts</TableHead>
            <TableHead>Ends</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {years.map((y) => (
            <TableRow key={y.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/settings/academic/years/${y.id}/terms`}
                  className="hover:underline"
                >
                  {y.label}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(y.startDate)}</TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(y.endDate)}</TableCell>
              <TableCell>
                {y.isCurrent ? (
                  <Badge variant="success">Current</Badge>
                ) : (
                  <Badge variant="muted">Not current</Badge>
                )}
              </TableCell>
              <TableCell className="flex gap-1">
                {!y.isCurrent && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSetCurrent(y)}
                    className="h-7"
                    title="Mark this year as the current one"
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Set current
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(y)}
                  className="h-7"
                  title="Edit"
                >
                  <Edit className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete(y)}
                  className="h-7 text-destructive hover:bg-destructive/10"
                  title="Delete"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
