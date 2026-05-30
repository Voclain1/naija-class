"use client";

import { ArrowLeft, Loader2, Pencil, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type {
  ClassArmDto,
  TeacherProfileDto,
  UserListItemDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listStaff, listTeacherProfiles } from "@/lib/staff/staff-api";

// /staff/[userId] — Slice 10 cp3 staff detail.
//
// Detail pages are for ACCEPTED staff (User rows). Pending invitations have
// no userId, so they aren't reachable here — they're surfaced inline on the
// roster instead. There is no resend-invitation endpoint in Phase 0 (the raw
// token isn't stored), so a "resend" affordance can't exist yet; re-issue is
// already on the roadmap (docs/deferred.md).
//
// No GET /users/:id or GET /teacher-profiles?userId=… endpoint exists, so we
// resolve both from their list endpoints client-side (the documented pattern
// — same as class-arm classTeacherId reverse-lookup). Fine at pilot scale.

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim() || "(no name)";
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function StaffDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  const [user, setUser] = useState<UserListItemDto | null>(null);
  const [profile, setProfile] = useState<TeacherProfileDto | null>(null);
  const [classArms, setClassArms] = useState<ClassArmDto[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const [staff, profiles, arms] = await Promise.all([
        listStaff(),
        listTeacherProfiles({ limit: 200 }),
        listClassArms({ includeInactive: true }),
      ]);
      const found = staff.find((u) => u.id === userId) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setUser(found);
      setProfile(profiles.data.find((p) => p.userId === userId) ?? null);
      setClassArms(arms.filter((a) => a.classTeacherId === userId));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Could not load this staff member.",
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          We couldn&apos;t find that staff member. They may have been removed,
          or the invitation hasn&apos;t been accepted yet.
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4" />
            Back to staff
          </Link>
        </Button>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? "Could not load this staff member."}
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4" />
            Back to staff
          </Link>
        </Button>
      </div>
    );
  }

  const roleLabel =
    user.roles.map((r) => r.name).join(", ") || "—";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/staff"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to staff
        </Link>
      </div>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {fullName(user.firstName, user.lastName)}
          </h1>
          <p className="text-sm text-muted-foreground">{user.email ?? "—"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {roleLabel}
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              Invitation accepted
            </span>
            {user.isActive ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                Active
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Inactive
              </span>
            )}
          </div>
        </div>
        <Button asChild variant={profile ? "outline" : "default"}>
          <Link href={`/staff/${userId}/edit`}>
            {profile ? (
              <>
                <Pencil className="h-4 w-4" />
                Edit profile
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Create profile
              </>
            )}
          </Link>
        </Button>
      </header>

      {/* Teacher profile */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Teacher profile
        </h2>
        {profile ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border bg-card p-4 sm:grid-cols-2">
            <Field label="Staff number" value={profile.staffNumber} />
            <Field label="Specialty" value={profile.specialty} />
            <Field
              label="Qualifications"
              value={profile.qualifications}
              span
            />
            <Field label="NUT number" value={profile.nutNumber} />
            <Field label="Joined" value={formatDate(profile.joinedAt)} />
          </dl>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">No teacher profile yet.</p>
            <p className="text-xs">
              This staff member has accepted their invitation but doesn&apos;t
              have an HR profile (staff number, specialty, qualifications). Add
              one to complete their record.
            </p>
            <Button asChild size="sm" className="mt-1">
              <Link href={`/staff/${userId}/edit`}>
                <UserPlus className="h-4 w-4" />
                Create profile
              </Link>
            </Button>
          </div>
        )}
      </section>

      {/* Class-teacher assignments */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Class-teacher assignments
        </h2>
        {classArms.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Not assigned as class teacher for any arm. Assign a class teacher
            from{" "}
            <Link
              href="/settings/academic"
              className="text-foreground underline underline-offset-2"
            >
              Academics → class arms
            </Link>
            .
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {classArms.map((arm) => (
              <li
                key={arm.id}
                className="flex items-center justify-between px-4 py-2 text-sm"
              >
                <span className="font-medium">{arm.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {arm.code}
                  {!arm.isActive ? " · inactive" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  span,
}: {
  label: string;
  value: string | null | undefined;
  span?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${span ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}
