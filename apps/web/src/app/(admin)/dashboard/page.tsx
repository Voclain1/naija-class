"use client";

import { GraduationCap } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Once your school is set up, this is where the day-to-day will live.
        </p>
      </div>
      <Card>
        <CardHeader className="items-start">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-6 w-6 text-muted-foreground" />
            <CardTitle className="text-lg">
              Get started by adding your first student
            </CardTitle>
          </div>
          <CardDescription className="ml-9">
            Build your roster one student at a time — bulk CSV import is
            arriving in a later slice.
          </CardDescription>
        </CardHeader>
        <CardContent className="ml-9">
          <Button asChild>
            <Link href="/students/new">Add a student</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
