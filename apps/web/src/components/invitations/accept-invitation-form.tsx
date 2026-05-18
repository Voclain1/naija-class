"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
  type PublicInvitationDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, setStoredToken } from "@/lib/api-client";
import { acceptInvitation } from "@/lib/invitations/invitations-api";
import { track } from "@/lib/observability/events";

// Extend the shared accept-invitation schema with a confirmPassword field +
// a refinement that the two passwords match. The server has no
// confirmPassword field; this is client-side ergonomics only.
const formSchema = acceptInvitationSchema
  .extend({
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

type FormValues = z.infer<typeof formSchema>;

interface Props {
  token: string;
  invitation: PublicInvitationDto;
}

// Human-readable "expires in N days" without pulling in date-fns. The server
// returns a timestamp; we render the rounded-up day count because that's
// what an invitation recipient actually cares about. Hours-only fallback for
// the last day so it doesn't read "expires in 0 days" when it expires today.
function describeExpiry(expiresAt: string | Date): string {
  const expiry = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const msLeft = expiry.getTime() - Date.now();
  if (msLeft <= 0) return "Expired";
  const hours = Math.floor(msLeft / (1000 * 60 * 60));
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export function AcceptInvitationForm({ token, invitation }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: invitation.firstName ?? "",
      lastName: invitation.lastName ?? "",
      password: "",
      confirmPassword: "",
      // Force the literal true type — react-hook-form's default cannot
      // satisfy z.literal(true) directly, so we coerce at submit time via
      // the explicit cast below rather than fighting the resolver here.
      ndprConsent: false as unknown as true,
    },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSubmitting(true);
    try {
      const payload: AcceptInvitationInput = {
        firstName: values.firstName,
        lastName: values.lastName,
        password: values.password,
        ndprConsent: true,
      };
      const res = await acceptInvitation(token, payload);

      // Track the acceptance BEFORE the hard navigation. PostHog buffers
      // events and flushes on `pagehide`, so the event will still ship,
      // but firing pre-navigate makes the order deterministic for tests.
      // The accepted role is always 'admin' at Phase 0 — invitation_sent
      // and invitation_accepted carry the same roleKey for funnel matching.
      track("invitation_accepted", {
        schoolId: res.school.id,
        roleKey: "admin",
      });

      // Store the bearer token, then push to /dashboard. The admin layout's
      // RequireAuth gate will rehydrate via /auth/me — but the AuthProvider
      // only hydrates on initial mount, so a same-tab redirect from this
      // public page would land on /dashboard with state still "guest" and
      // bounce to /login. Hard navigation forces a fresh mount, which
      // re-reads the token from localStorage and resolves to "authed".
      setStoredToken(res.token);
      window.location.href = "/dashboard";
    } catch (error) {
      if (error instanceof ApiError) {
        // Surface the API code to the user — they may need to take action
        // (e.g. EMAIL_TAKEN means "you already have an account, sign in").
        if (error.code === "INVITATION_ALREADY_ACCEPTED") {
          setFormError(
            "This invitation was just used. If that wasn't you, contact your administrator.",
          );
        } else if (error.code === "INVITATION_EXPIRED") {
          setFormError("This invitation expired before you could accept it.");
        } else if (error.code === "EMAIL_TAKEN") {
          setFormError(
            "An account already exists for this email. Try signing in instead.",
          );
        } else if (error.code === "VALIDATION_ERROR") {
          setFormError("Please check the form and try again.");
        } else {
          toast.error(error.message);
        }
      } else {
        toast.error("Could not reach the server. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Join {invitation.schoolName} as admin</CardTitle>
        <CardDescription>
          Invited by {invitation.invitedByName}. {describeExpiry(invitation.expiresAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {/* Email shown read-only — the invitation pins which address this
              account is for. */}
          <div className="flex flex-col gap-1">
            <Label>Email</Label>
            <Input value={invitation.email} disabled readOnly />
          </div>

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                autoComplete="given-name"
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
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                autoComplete="family-name"
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

          <div className="flex flex-col gap-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register("password")}
              aria-invalid={Boolean(form.formState.errors.password)}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive">
                {form.formState.errors.password.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              At least 8 characters, with at least one letter and one digit.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register("confirmPassword")}
              aria-invalid={Boolean(form.formState.errors.confirmPassword)}
            />
            {form.formState.errors.confirmPassword && (
              <p className="text-sm text-destructive">
                {form.formState.errors.confirmPassword.message}
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              {...form.register("ndprConsent")}
              aria-invalid={Boolean(form.formState.errors.ndprConsent)}
            />
            <span>
              I accept the data handling terms and understand my information
              will be used to operate this school&apos;s account.
            </span>
          </label>
          {form.formState.errors.ndprConsent && (
            <p className="text-sm text-destructive">
              You must accept the data handling terms to continue.
            </p>
          )}

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Accepting…" : "Accept invitation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
