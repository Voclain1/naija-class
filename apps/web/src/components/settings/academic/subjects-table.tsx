"use client";

import { Edit, Trash2 } from "lucide-react";

import type { SubjectCategoryDto, SubjectDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props {
  subjects: SubjectDto[];
  onEdit: (subject: SubjectDto) => void;
  onDelete: (subject: SubjectDto) => void;
}

const CATEGORY_LABEL: Record<SubjectCategoryDto, string> = {
  CORE: "Core",
  ELECTIVE: "Elective",
  VOCATIONAL: "Vocational",
};

const CATEGORY_CLASSES: Record<SubjectCategoryDto, string> = {
  CORE: "bg-emerald-100 text-emerald-700",
  ELECTIVE: "bg-sky-100 text-sky-700",
  VOCATIONAL: "bg-amber-100 text-amber-700",
};

export function SubjectsTable({ subjects, onEdit, onDelete }: Props) {
  if (subjects.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No subjects yet. Add one to get started.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {subjects.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {s.code}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={cn("border-transparent", CATEGORY_CLASSES[s.category])}>
                  {CATEGORY_LABEL[s.category]}
                </Badge>
              </TableCell>
              <TableCell>
                {s.isActive ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="muted">Inactive</Badge>
                )}
              </TableCell>
              <TableCell className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(s)}
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
                  onClick={() => onDelete(s)}
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
