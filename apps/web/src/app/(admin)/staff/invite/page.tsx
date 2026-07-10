"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { InviteAdminInput, InviteAdminResponse } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { inviteStaff } from "@/lib/staff/staff-api";

// /staff/invite — Slice 10 cp3, role dropdown added Phase 3 slice 15 cp2.
//
// Originally cp3 shipped no role field: POST /users/invite hardcoded
// roleKey="admin" server-side, so this form could only create an
// administrator (a role dropdown would have been a silent privilege-
// escalation bug — passing "teacher" would have been ignored server-side
// and granted ADMIN instead). Slice 15 added a real roleKey field to
// inviteAdminSchema/UsersService.invite, but ONLY for "admin" | "bursar" —
// teacher still goes through the bulk CSV import (a separate, still-open
// deferred.md item, since TeacherProfile fields aren't on this path), so
// the dropdown below intentionally offers just the two roles the API
// actually accepts.
//
// Form-class protection (yesterday's class-arm lesson):
//   (a) Local `inviteFormSchema` matches FormValues exactly (all strings;
//       firstName/lastName allow "" so blank optionals don't trip
//       `.min(1).optional()` — the deferred.md empty-optional bug). No
//       `as never` cast needed because resolver output === FormValues.
//   (b) Root error block + per-field error rendered. No silent submit.

const inviteFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
  firstName: z.string().trim().max(60, "First name is too long."),
  lastName: z.string().trim().max(60, "Last name is too long."),
  roleKey: z.enum(["admin", "bursar"]),
});

type FormValues = z.infer<typeof inviteFormSchema>;

export default function InviteStaffPage() {
  const [created, setCreated] = useState<InviteAdminResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: "", firstName: "", lastName: "", roleKey: "admin" },
    mode: "onSubmit",
  });

  const roleKey = form.watch("roleKey");

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // Strip blank optional names to undefined — the API schema accepts the
      // fields absent but rejects empty strings (.min(1)).
      const payload: InviteAdminInput = {
        email: values.email,
        firstName: values.firstName ? values.firstName : undefined,
        lastName: values.lastName ? values.lastName : undefined,
        roleKey: values.roleKey,
      };
      const res = await inviteStaff(payload);
      setCreated(res);
      setCopied(false);
      form.reset({ email: "", firstName: "", lastName: "", roleKey: "admin" });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "EMAIL_TAKEN") {
          form.setError("email", {
            type: "manual",
            message: "A user with that email already exists in this school.",
          });
        } else if (error.code === "INVITATION_ALREADY_PENDING") {
          form.setError("email", {
            type: "manual",
            message: "An unexpired invitation already exists for that email.",
          });
        } else if (error.code === "SCHOOL_NOT_ACTIVE") {
          form.setError("root", {
            type: "manual",
            message: "Finish onboarding before inviting other staff.",
          });
        } else {
          form.setError("root", { type: "manual", message: error.message });
        }
      } else {
        form.setError("root", {
          type: "manual",
          message: "Could not reach the server. Try again in a moment.",
        });
      }
    }
  });

  const onCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.acceptUrl);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (insecure context / permissions) — the URL
      // is still visible in the input for manual selection.
      setCopied(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Invitation created
          </h1>
          <p className="text-sm text-muted-foreground">
            Email delivery arrives in a later phase. For now, copy this link
            and send it to <strong>{created.invitation.email}</strong>{" "}
            yourself. It expires in 7 days and can only be used once.
          </p>
        </header>

        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4">
          <Label htmlFor="accept-url">Accept link</Label>
          <div className="flex gap-2">
            <Input
              id="accept-url"
              readOnly
              value={created.acceptUrl}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={onCopy}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            We don&apos;t store this link — once you leave this page it
            can&apos;t be shown again. (Re-issuing a missed invite is on the
            roadmap.)
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setCreated(null)}>
            Invite another
          </Button>
          <Button asChild>
            <Link href="/staff">View staff</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Invite a staff member
        </h1>
        <p className="text-sm text-muted-foreground">
          They&apos;ll get a link to set their password and join your school
          as {roleKey === "bursar" ? "a bursar" : "an admin"}.
        </p>
      </header>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Inviting a teacher?</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Teachers join through the bulk CSV import — they receive an invite
          link and set their own password.{" "}
          <Link
            href="/staff/import"
            className="text-foreground underline underline-offset-2"
          >
            Import teachers from CSV →
          </Link>
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formState.errors.root && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            autoFocus
            {...form.register("email")}
            aria-invalid={Boolean(form.formState.errors.email)}
          />
          {form.formState.errors.email && (
            <p className="text-sm text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            {...form.register("roleKey")}
          >
            <option value="admin">Admin</option>
            <option value="bursar">Bursar</option>
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="invite-firstName">First name (optional)</Label>
            <Input
              id="invite-firstName"
              {...form.register("firstName")}
              aria-invalid={Boolean(form.formState.errors.firstName)}
            />
            {form.formState.errors.firstName && (
              <p className="text-sm text-destructive">
                {form.formState.errors.firstName.message}
              </p>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="invite-lastName">Last name (optional)</Label>
            <Input
              id="invite-lastName"
              {...form.register("lastName")}
              aria-invalid={Boolean(form.formState.errors.lastName)}
            />
            {form.formState.errors.lastName && (
              <p className="text-sm text-destructive">
                {form.formState.errors.lastName.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href="/staff">Cancel</Link>
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {form.formState.isSubmitting ? "Sending…" : "Send invitation"}
          </Button>
        </div>
      </form>
    </div>
  );
}
