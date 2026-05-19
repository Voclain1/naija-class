"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";

export default function HomePage() {
  const { status } = useAuth();
  const isAuthed = status === "authed";
  const broken = undefinedSymbolThatDoesNotExist;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">School Kit</h1>
        <p className="mt-2 text-muted-foreground">
          Phase 0 — auth and admin shell live. Marketing landing comes later.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href={isAuthed ? "/dashboard" : "/signup"}>
            {isAuthed ? "Go to dashboard" : "Create a school"}
          </Link>
        </Button>
        {!isAuthed && (
          <Button asChild variant="outline">
            <Link href="/login">Log in</Link>
          </Button>
        )}
      </div>
    </main>
  );
}
