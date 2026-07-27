"use client";

import { Edit, Trash2 } from "lucide-react";

import type { ClassLevelDto, ClassStageDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Order</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {levels.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="text-muted-foreground">{l.orderIndex}</TableCell>
              <TableCell className="font-medium">{l.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {l.code}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {STAGE_LABEL[l.stage]}
              </TableCell>
              <TableCell>
                {l.isActive ? (
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
