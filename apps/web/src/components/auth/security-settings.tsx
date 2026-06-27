"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "react-qr-code";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  totpConfirmSchema,
  totpDisableSchema,
  type TotpConfirmInput,
  type TotpDisableInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  twoFactorConfirmRequest,
  twoFactorDisableRequest,
  twoFactorSetupRequest,
  twoFactorStatusRequest,
} from "@/lib/auth/auth-api";

// Three phases of the enable flow:
//   idle       — not yet started (show "Set up" button)
//   setup      — secret generated, QR shown, awaiting confirm code
//   confirming — code submitted, waiting for API response
type SetupPhase = "idle" | "setup" | "confirming";

interface SetupState {
  phase: SetupPhase;
  otpAuthUrl: string;
  secret: string;
}

export function SecuritySettings() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [setup, setSetup] = useState<SetupState>({ phase: "idle", otpAuthUrl: "", secret: "" });
  const [disabling, setDisabling] = useState(false);
  const [showDisableForm, setShowDisableForm] = useState(false);

  const confirmForm = useForm<TotpConfirmInput>({
    resolver: zodResolver(totpConfirmSchema),
    defaultValues: { code: "" },
    mode: "onSubmit",
  });

  const disableForm = useForm<TotpDisableInput>({
    resolver: zodResolver(totpDisableSchema),
    defaultValues: { currentPassword: "" },
    mode: "onSubmit",
  });

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await twoFactorStatusRequest();
      setEnabled(status.enabled);
    } catch {
      toast.error("Could not load 2FA status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSetup = async () => {
    try {
      const result = await twoFactorSetupRequest();
      setSetup({ phase: "setup", otpAuthUrl: result.otpAuthUrl, secret: result.secret });
      confirmForm.reset();
    } catch {
      toast.error("Could not start 2FA setup. Try again.");
    }
  };

  const onConfirmSubmit = confirmForm.handleSubmit(async (values) => {
    setSetup((s) => ({ ...s, phase: "confirming" }));
    try {
      await twoFactorConfirmRequest(values);
      setEnabled(true);
      setSetup({ phase: "idle", otpAuthUrl: "", secret: "" });
      toast.success("Two-factor authentication enabled.");
    } catch (error) {
      setSetup((s) => ({ ...s, phase: "setup" }));
      if (error instanceof ApiError && error.code === "INVALID_2FA_CODE") {
        confirmForm.setError("code", {
          type: "manual",
          message: "Incorrect code. Try again.",
        });
      } else {
        toast.error("Could not confirm code. Try again.");
      }
    }
  });

  const onDisableSubmit = disableForm.handleSubmit(async (values) => {
    setDisabling(true);
    try {
      await twoFactorDisableRequest(values);
      setEnabled(false);
      setShowDisableForm(false);
      disableForm.reset();
      toast.success("Two-factor authentication disabled.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        disableForm.setError("currentPassword", {
          type: "manual",
          message: "Incorrect password.",
        });
      } else {
        toast.error("Could not disable 2FA. Try again.");
      }
    } finally {
      setDisabling(false);
    }
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-6">
      {/* Status banner */}
      <div
        className={`flex items-center gap-3 rounded-md border p-4 ${
          enabled
            ? "border-green-200 bg-green-50 text-green-800"
            : "border-border bg-muted/40 text-muted-foreground"
        }`}
      >
        {enabled ? (
          <ShieldCheck className="h-5 w-5 shrink-0 text-green-600" />
        ) : (
          <ShieldOff className="h-5 w-5 shrink-0" />
        )}
        <div>
          <p className="text-sm font-medium">
            {enabled ? "Two-factor authentication is enabled" : "Two-factor authentication is off"}
          </p>
          <p className="text-xs">
            {enabled
              ? "Your account is protected with an authenticator app."
              : "Add an extra layer of security to your account."}
          </p>
        </div>
      </div>

      {/* Enable flow */}
      {!enabled && setup.phase === "idle" && (
        <Button onClick={() => void handleSetup()} className="w-fit">
          Set up two-factor authentication
        </Button>
      )}

      {!enabled && (setup.phase === "setup" || setup.phase === "confirming") && (
        <div className="flex flex-col gap-5 rounded-md border p-5">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Scan this QR code</p>
            <p className="text-xs text-muted-foreground">
              Open your authenticator app (Google Authenticator, Authy, etc.) and scan
              the code below.
            </p>
          </div>

          <div className="flex justify-center rounded-md bg-white p-4">
            <QRCode value={setup.otpAuthUrl} size={180} />
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Can&apos;t scan? Enter the key manually
            </summary>
            <code className="mt-2 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {setup.secret}
            </code>
          </details>

          <form onSubmit={onConfirmSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-code">Verification code</Label>
              <Input
                id="confirm-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                {...confirmForm.register("code")}
                aria-invalid={Boolean(confirmForm.formState.errors.code)}
              />
              {confirmForm.formState.errors.code && (
                <p className="text-sm text-destructive">
                  {confirmForm.formState.errors.code.message}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={setup.phase === "confirming"}>
                {setup.phase === "confirming" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {setup.phase === "confirming" ? "Verifying…" : "Confirm and enable"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSetup({ phase: "idle", otpAuthUrl: "", secret: "" })}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Disable flow */}
      {enabled && !showDisableForm && (
        <Button
          variant="destructive"
          className="w-fit"
          onClick={() => setShowDisableForm(true)}
        >
          Disable two-factor authentication
        </Button>
      )}

      {enabled && showDisableForm && (
        <div className="flex flex-col gap-4 rounded-md border border-destructive/30 p-5">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Disable two-factor authentication</p>
            <p className="text-xs text-muted-foreground">
              Enter your current password to confirm. You can re-enable 2FA at any time.
            </p>
          </div>
          <form onSubmit={onDisableSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                {...disableForm.register("currentPassword")}
                aria-invalid={Boolean(disableForm.formState.errors.currentPassword)}
              />
              {disableForm.formState.errors.currentPassword && (
                <p className="text-sm text-destructive">
                  {disableForm.formState.errors.currentPassword.message}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="submit" variant="destructive" disabled={disabling}>
                {disabling && <Loader2 className="h-4 w-4 animate-spin" />}
                {disabling ? "Disabling…" : "Disable 2FA"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowDisableForm(false);
                  disableForm.reset();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Success confirmation (after enable) */}
      {enabled && !showDisableForm && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          Every sign-in will now require a code from your authenticator app.
        </div>
      )}
    </div>
  );
}
