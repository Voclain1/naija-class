"use client";

import { Edit, ListPlus, Trash2 } from "lucide-react";

import type { ClassArmDto, ClassLevelDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  levels: ClassLevelDto[];
  arms: ClassArmDto[];
  onAdd: (level: ClassLevelDto) => void;
  onEdit: (arm: ClassArmDto) => void;
  onDelete: (arm: ClassArmDto) => void;
}

// One <section> per level (ordered by orderIndex). Levels with no arms
// still render with their header + an inline "Add arm" CTA — admins can
// drop arms onto any level without navigating back to the header button.
export function ClassArmsTable({
  levels,
  arms,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  if (levels.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No class levels yet. Add one in the Class Levels tab first.
      </p>
    );
  }

  const armsByLevel = new Map<string, ClassArmDto[]>();
  for (const arm of arms) {
    const list = armsByLevel.get(arm.classLevelId) ?? [];
    list.push(arm);
    armsByLevel.set(arm.classLevelId, list);
  }

  return (
    <div className="flex flex-col gap-6">
      {levels.map((level) => {
        const levelArms = armsByLevel.get(level.id) ?? [];
        return (
          <section key={level.id} className="rounded-md border">
            <header className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
              <h2 className="text-sm font-semibold">
                {level.name}{" "}
                <span className="font-normal text-muted-foreground">
                  · {levelArms.length}{" "}
                  {levelArms.length === 1 ? "arm" : "arms"}
                </span>
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onAdd(level)}
                className="h-7"
              >
                <ListPlus className="mr-1 h-3 w-3" />
                Add arm
              </Button>
            </header>
            {levelArms.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No arms yet for {level.name}.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Class teacher</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {levelArms.map((arm) => (
                    <TableRow key={arm.id}>
                      <TableCell className="font-medium">{arm.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {arm.code}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {arm.capacity ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {arm.classTeacherId ? (
                          <span className="font-mono text-xs">
                            {arm.classTeacherId.slice(0, 8)}…
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {arm.isActive ? (
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
                          onClick={() => onEdit(arm)}
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
                          onClick={() => onDelete(arm)}
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
            )}
          </section>
        );
      })}
    </div>
  );
}
