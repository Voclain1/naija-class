"use client";

import { Edit, Trash2 } from "lucide-react";

import type { SubjectCategoryDto, SubjectDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";

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
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((s) => (
            <tr key={s.id} className="border-t">
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {s.code}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${CATEGORY_CLASSES[s.category]}`}
                >
                  {CATEGORY_LABEL[s.category]}
                </span>
              </td>
              <td className="px-3 py-2">
                {s.isActive ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                    Active
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Inactive
                  </span>
                )}
              </td>
              <td className="flex gap-1 px-3 py-2">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
