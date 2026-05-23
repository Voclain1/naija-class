"use client";

import { Edit, Trash2 } from "lucide-react";

import type { ClassLevelDto, ClassStageDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";

interface Props {
  levels: ClassLevelDto[];
  onEdit: (level: ClassLevelDto) => void;
  onDelete: (level: ClassLevelDto) => void;
}

const STAGE_LABEL: Record<ClassStageDto, string> = {
  NURSERY: "Nursery",
  PRIMARY: "Primary",
  JSS: "JSS",
  SSS: "SSS",
};

export function ClassLevelsTable({ levels, onEdit, onDelete }: Props) {
  if (levels.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No class levels yet. Add one to get started.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-16 px-3 py-2 font-medium">Order</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Stage</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.id} className="border-t">
              <td className="px-3 py-2 text-muted-foreground">{l.orderIndex}</td>
              <td className="px-3 py-2 font-medium">{l.name}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {l.code}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {STAGE_LABEL[l.stage]}
              </td>
              <td className="px-3 py-2">
                {l.isActive ? (
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
                  onClick={() => onEdit(l)}
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
                  onClick={() => onDelete(l)}
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
