"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  PLATFORM_ADMIN_AI_BUDGET_MAX,
  type PlatformAdminCancelOwnerInvitationResponse,
  type PlatformAdminResendOwnerInvitationInput,
  type PlatformAdminResendOwnerInvitationResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetAiBudgetInput,
  type PlatformAdminSetAiBudgetResponse,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, proxyFetch } from "@/lib/api-client";

import { ownerStatusOf, parseTokenCount } from "./school-manage";

// Platform-admin tools, slice 1 (2026-10-06): one school's settings that are
// too wordy for a table cell — the AI spend cap, and the owner invitation for
// a school nobody has taken over yet. A dialog rather than more columns: the
// table is already wide, and the operator often works from a tablet.

interface Props {
  school: PlatformAdminSchoolDto | null;
  onClose: () => void;
  /** Patch the roster row in place — the response is authoritative for what changed. */
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}

const fmt = (n: number) => n.toLocaleString("en-NG");

export function SchoolManageDialog({ school, onClose, onChanged }: Props) {
  const [budgetDraft, setBudgetDraft] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [inviteBusy, setInviteBusy] = useState<"resend" | "cancel" | null>(
    null,
  );
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);

  useEffect(() => {
    setBudgetDraft(
      school?.aiMonthlyTokenBudget != null
        ? fmt(school.aiMonthlyTokenBudget)
        : "",
    );
    setEmailDraft("");
    setLastAcceptUrl(null);
  }, [school?.schoolId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when a different school opens

  if (!school) return null;

  const parsed = parseTokenCount(budgetDraft);
  const budgetValid = parsed !== null && parsed <= PLATFORM_ADMIN_AI_BUDGET_MAX;
  const owner = ownerStatusOf(school);

  async function saveBudget(value: number | null) {
    if (!school) return;
    setSavingBudget(true);
    try {
      const payload: PlatformAdminSetAiBudgetInput = {
        aiMonthlyTokenBudget: value,
      };
      const res = await proxyFetch<PlatformAdminSetAiBudgetResponse>(
        `/api/platform-admin/schools/${school.schoolId}/ai-budget`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      onChanged({
        aiMonthlyTokenBudget: res.aiMonthlyTokenBudget,
        aiEffectiveMonthlyTokenBudget: res.aiEffectiveMonthlyTokenBudget,
      });
      setBudgetDraft(
        res.aiMonthlyTokenBudget != null ? fmt(res.aiMonthlyTokenBudget) : "",
      );
      toast.success(
        res.aiMonthlyTokenBudget == null
          ? `${school.name} is back on the platform default (${fmt(res.aiEffectiveMonthlyTokenBudget)} tokens a month).`
          : `${school.name} is capped at ${fmt(res.aiMonthlyTokenBudget)} tokens a month.`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not save the AI budget.",
      );
    } finally {
      setSavingBudget(false);
    }
  }

  function onSubmitBudget(e: FormEvent) {
    e.preventDefault();
    if (budgetValid) void saveBudget(parsed);
  }

  async function resend() {
    if (!school) return;
    const corrected = emailDraft.trim();
    const target = corrected || "the same address as before";
    if (
      !window.confirm(
        `Send a new owner invitation for ${school.name} to ${target}? Any earlier link stops working.`,
      )
    )
      return;
    setInviteBusy("resend");
    try {
      const payload: PlatformAdminResendOwnerInvitationInput = corrected
        ? { ownerEmail: corrected }
        : {};
      const res = await proxyFetch<PlatformAdminResendOwnerInvitationResponse>(
        `/api/platform-admin/schools/${school.schoolId}/owner-invitation/resend`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      setLastAcceptUrl(res.acceptUrl);
      setEmailDraft("");
      onChanged({
        ownerInvitePending: true,
        ownerInviteExpiresAt: res.invitationExpiresAt,
      });
      toast.success(`New invitation sent to ${res.ownerEmail}.`);
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Could not send the invitation.",
      );
    } finally {
      setInviteBusy(null);
    }
  }

  async function cancel() {
    if (!school) return;
    if (
      !window.confirm(
        `Cancel the owner invitation for ${school.name}? The link already sent stops working.`,
      )
    )
      return;
    setInviteBusy("cancel");
    try {
      const res = await proxyFetch<PlatformAdminCancelOwnerInvitationResponse>(
        `/api/platform-admin/schools/${school.schoolId}/owner-invitation/cancel`,
        { method: "POST" },
      );
      setLastAcceptUrl(null);
      onChanged({ ownerInvitePending: false, ownerInviteExpiresAt: null });
      toast.success(
        res.cancelledCount > 0
          ? "Invitation cancelled."
          : "There was no open invitation to cancel.",
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Could not cancel the invitation.",
      );
    } finally {
      setInviteBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{school.name}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{school.slug}</span> ·{" "}
            <span className="font-mono text-xs">{school.schoolId}</span>
          </DialogDescription>
        </DialogHeader>

        <section
          className="flex flex-col gap-3"
          aria-labelledby="manage-ai-budget"
        >
          <h3 id="manage-ai-budget" className="font-medium">
            AI monthly budget
          </h3>
          <p className="text-sm text-muted-foreground">
            {school.aiMonthlyTokenBudget == null ? (
              <>
                On the platform default:{" "}
                <strong className="text-foreground">
                  {fmt(school.aiEffectiveMonthlyTokenBudget)}
                </strong>{" "}
                tokens a month.
              </>
            ) : (
              <>
                Capped at{" "}
                <strong className="text-foreground">
                  {fmt(school.aiMonthlyTokenBudget)}
                </strong>{" "}
                tokens a month.
              </>
            )}{" "}
            The cap applies from the school&apos;s next AI request.{" "}
            {school.aiEnabled
              ? ""
              : "AI is switched off for this school, so nothing is being spent."}
          </p>
          <form
            onSubmit={onSubmitBudget}
            className="flex flex-wrap items-end gap-2"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-budget">Tokens a month</Label>
              <Input
                id="ai-budget"
                inputMode="numeric"
                value={budgetDraft}
                onChange={(e) => setBudgetDraft(e.target.value)}
                placeholder={fmt(school.aiEffectiveMonthlyTokenBudget)}
                className="w-44"
              />
            </div>
            <Button type="submit" disabled={!budgetValid || savingBudget}>
              {savingBudget ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Set cap
            </Button>
            {school.aiMonthlyTokenBudget != null ? (
              <Button
                type="button"
                variant="outline"
                disabled={savingBudget}
                onClick={() => void saveBudget(null)}
              >
                Use platform default
              </Button>
            ) : null}
          </form>
          {budgetDraft.trim() && !budgetValid ? (
            <p className="text-sm text-destructive">
              Enter a whole number of tokens, up to{" "}
              {fmt(PLATFORM_ADMIN_AI_BUDGET_MAX)}.
            </p>
          ) : null}
        </section>

        <section
          className="flex flex-col gap-3 border-t pt-4"
          aria-labelledby="manage-owner"
        >
          <h3 id="manage-owner" className="font-medium">
            Owner
          </h3>
          {owner.kind === "HAS_OWNER" ? (
            <p className="text-sm text-muted-foreground">
              <Badge variant="success" className="mr-2">
                Has an owner
              </Badge>
              They invite staff from the school&apos;s own settings, so there is
              nothing to do here.
            </p>
          ) : (
            <>
              <p className="text-sm">
                {owner.kind === "INVITE_PENDING" ? (
                  <>
                    <Badge variant="warning" className="mr-2">
                      Invitation sent
                    </Badge>
                    Not accepted yet. The link works until{" "}
                    {new Date(owner.expiresAt).toLocaleDateString()}.
                  </>
                ) : (
                  <>
                    <Badge variant="muted" className="mr-2">
                      No owner
                    </Badge>
                    Nobody has accepted an owner invitation, and no link is
                    open.
                  </>
                )}
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="owner-email">
                  Send to a different address (optional)
                </Label>
                <Input
                  id="owner-email"
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="Leave blank to use the last address"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={inviteBusy !== null}
                  onClick={() => void resend()}
                >
                  {inviteBusy === "resend" ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  Send new invitation
                </Button>
                {owner.kind === "INVITE_PENDING" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={inviteBusy !== null}
                    onClick={() => void cancel()}
                  >
                    {inviteBusy === "cancel" ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : null}
                    Cancel invitation
                  </Button>
                ) : null}
              </div>
              {lastAcceptUrl ? (
                <p className="break-all text-sm text-muted-foreground">
                  Invite link (if the email doesn&apos;t arrive):{" "}
                  <a
                    href={lastAcceptUrl}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {lastAcceptUrl}
                  </a>
                </p>
              ) : null}
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
