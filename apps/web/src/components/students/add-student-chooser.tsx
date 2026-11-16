"use client";

import { UserPlus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// One obvious front door. The intake page explains every method with enough
// context to choose safely; a second chooser here made users decide twice.

export function AddStudentChooser({ size = "sm" }: { size?: "sm" | "default" }) {
  return (
    <Button asChild size={size}>
      <Link href="/students/intake">
          <UserPlus className="h-4 w-4" />
          Add students
      </Link>
    </Button>
  );
}
