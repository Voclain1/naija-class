"use client";

import Link from "next/link";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";

export default function HomePage() {
  const { status } = useAuth();
  const isAuthed = status === "authed";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 p-8">
      <div>
        <SchoolKitWordmark iconSize={36} textClassName="text-3xl" />
        <p className="mt-2 text-muted-foreground">
          Log in to your school, or create a new one to get started.
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
