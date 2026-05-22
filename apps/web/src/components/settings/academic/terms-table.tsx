"use client";

import { Check, Edit, Trash2 } from "lucide-react";

import type { TermDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";

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
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Starts</th>
            <th className="px-3 py-2 font-medium">Ends</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((t) => (
            <tr key={t.id} className="border-t">
              <td className="px-3 py-2 font-mono text-muted-foreground">{t.sequence}</td>
              <td className="px-3 py-2 font-medium">{t.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(t.startDate)}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(t.endDate)}</td>
              <td className="px-3 py-2">
                {t.isCurrent ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                    Current
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Not current
                  </span>
                )}
              </td>
              <td className="flex gap-1 px-3 py-2">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
