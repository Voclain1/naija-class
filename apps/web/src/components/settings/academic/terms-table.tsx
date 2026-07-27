"use client";

import { Check, Edit, Trash2 } from "lucide-react";

import type { TermDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  terms: TermDto[];
  onEdit: (term: TermDto) => void;
  onSetCurrent: (term: TermDto) => void;
  onDelete: (term: TermDto) => void;
}

function fmtDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString();
}

export function TermsTable({ terms, onEdit, onSetCurrent, onDelete }: Props) {
  if (terms.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No terms yet. Add the first one (sequence 1) to get started.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Starts</TableHead>
            <TableHead>Ends</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {terms.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-mono text-muted-foreground">{t.sequence}</TableCell>
              <TableCell className="font-medium">{t.name}</TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(t.startDate)}</TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(t.endDate)}</TableCell>
              <TableCell>
                {t.isCurrent ? (
                  <Badge variant="success">Current</Badge>
                ) : (
                  <Badge variant="muted">Not current</Badge>
                )}
              </TableCell>
              <TableCell className="flex gap-1">
                {!t.isCurrent && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSetCurrent(t)}
                    className="h-7"
                    title="Mark this term as the current one (also marks the parent year)"
                  >
                    <Check className="mr-1 h-3 w-3" />
                    Set current
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(t)}
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
                  onClick={() => onDelete(t)}
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
