"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { resetPasswordSchema } from "@school-kit/types";

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
import { ApiError } from "@/lib/api-client";
import { resetPasswordRequest } from "@/lib/auth/auth-api";

// Extend the shared reset-password schema with a confirmPassword field, same
// pattern as AcceptInvitationForm — server has no confirmPassword field,
// client-side ergonomics only.
const formSchema = z
  .object({ password: resetPasswordSchema.shape.password, confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

type FormValues = z.infer<typeof formSchema>;

interface Props {
  token: string;
}

// No GET pre-check endpoint exists for this token (unlike invitations' GET
// /invitations/:token) — deliberately out of scope, see auth.controller.ts's
// comment on POST /auth/reset-password. So the form always renders first;
// an expired/used/unknown token is only discovered on submit, at which
// point this swaps to the same kind of error card the invitation flow shows
// up front.
type State =
  | { status: "form" }
  | { status: "error"; variant: "expired" | "used" | "notFound" }
  | { status: "success" };

export function ResetPasswordForm({ token }: Props) {
  const [state, setState] = useState<State>({ status: "form" });
  const [submitting, setSubmitting] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    setNetworkError(null);
    try {
      await resetPasswordRequest({ token, password: values.password });
      setState({ status: "success" });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "PASSWORD_RESET_EXPIRED") {
          setState({ status: "error", variant: "expired" });
        } else if (error.code === "PASSWORD_RESET_ALREADY_USED") {
          setState({ status: "error", variant: "used" });
        } else if (error.code === "NOT_FOUND") {
          setState({ status: "error", variant: "notFound" });
        } else {
          setNetworkError(error.message);
        }
      } else {
        setNetworkError("Could not reach the server. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  });

  if (state.status === "success") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Password reset</CardTitle>
          <CardDescription>
            Your password has been changed. Sign in with your new password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.status === "error") {
    const copy = {
      expired: {
        title: "This link has expired",
        description: "Password reset links are only valid for 1 hour. Request a new one below.",
      },
      used: {
        title: "This link has already been used",
        description: "If that wasn't you, request a new link and reset your password again.",
      },
      notFound: {
        title: "Link not found",
        description: "This password reset link is invalid. Request a new one below.",
      },
    }[state.variant];

    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              {...form.register("password")}
              aria-invalid={Boolean(form.formState.errors.password)}
            />
            {form.formState.errors.password && (
              <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              At least 8 characters, with uppercase, lowercase, a digit, and a special character.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
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

          {networkError && <p className="text-sm text-destructive">{networkError}</p>}

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Resetting…" : "Reset password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
