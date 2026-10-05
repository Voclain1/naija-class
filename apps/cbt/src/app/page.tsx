"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Card, Input, Screen } from "@/components/ui";

// cbt.schoolkit.ng — the bare address. The invigilator sheet prints the
// school's own link (…/<school>); this page is for when only the bare address
// was typed.
export default function Home() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const clean = slug.trim().toLowerCase().replace(/^.*\//, "");
  return (
    <Screen>
      <h1 className="font-serif text-3xl">SchoolKit Exams</h1>
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean) router.push(`/${encodeURIComponent(clean)}`);
          }}
        >
          <label htmlFor="school" className="text-sm font-medium">
            Your school&apos;s web address name
          </label>
          <Input id="school" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. greenfield-academy" autoComplete="off" />
          <p className="text-sm text-muted-foreground">It is printed on the invigilator sheet, after cbt.schoolkit.ng/.</p>
          <Button type="submit" disabled={!clean}>
            Continue
          </Button>
        </form>
      </Card>
    </Screen>
  );
}
