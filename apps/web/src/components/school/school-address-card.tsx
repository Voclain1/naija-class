"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  normaliseSchoolAddress,
  schoolAddressProblem,
  schoolHost,
  type SchoolAddressCheckDto,
  type SchoolAddressDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { getSchoolMe } from "@/lib/onboarding/schools-api";
import { availabilityCopy, formatAddressDate } from "@/lib/school-address/address-copy";
import { changeSchoolAddress, checkSchoolAddress, getSchoolAddress } from "@/lib/school-address/school-address-api";
import { cn } from "@/lib/utils";

/**
 * Settings → School: the school's web address, "<code>.schoolkit.ng"
 * (docs/modules/school-addresses.md). The owner changes it within the limits;
 * the old one keeps working, so nothing printed or shared breaks.
 */
export function SchoolAddressCard() {
  const { school, setSchool } = useAuth();
  const [address, setAddress] = useState<SchoolAddressDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<SchoolAddressCheckDto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSchoolAddress()
      .then(setAddress)
      .catch(() => setAddress(null));
  }, []);

  // Check as the owner types, a moment after they stop.
  const code = normaliseSchoolAddress(draft);
  useEffect(() => {
    if (!editing || code.length === 0) {
      setCheck(null);
      return;
    }
    const local = schoolAddressProblem(code);
    if (local) {
      setCheck({ code, host: schoolHost(code), status: local });
      return;
    }
    const timer = setTimeout(() => {
      checkSchoolAddress(code)
        .then(setCheck)
        .catch(() => setCheck(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [code, editing]);

  if (!address) return null;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const next = await changeSchoolAddress(code);
      setAddress(next);
      setEditing(false);
      setDraft("");
      setSchool(await getSchoolMe());
      toast.success(`Your school's address is now ${next.host}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't change the address — try again.");
    } finally {
      setSaving(false);
    }
  }

  const copy = check ? availabilityCopy(check.status) : null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <Label>School web address</Label>
        <p className="text-base font-medium text-foreground">{address.host}</p>
        <p className="text-sm text-muted-foreground">
          Families use this address to find your school. It is also the school code students type to sign in.
        </p>
        {school?.siteUrls?.home && (
          <a href={school.siteUrls.home} target="_blank" rel="noreferrer" className="self-start text-sm text-primary underline-offset-2 hover:underline">
            View your school&apos;s page
          </a>
        )}
      </div>

      {address.previousCodes.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Earlier addresses still work and lead here: {address.previousCodes.map((c) => schoolHost(c)).join(", ")}.
        </p>
      )}

      {address.blockedReason ? (
        <p className="text-sm text-muted-foreground">
          {address.blockedReason}
          {address.nextChangeAt && ` You can change it again from ${formatAddressDate(address.nextChangeAt)}.`}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {address.freeUntil
            ? `You can change it freely until ${formatAddressDate(address.freeUntil)}. After that, up to 2 changes a year.`
            : address.changesLeft < 2
              ? `You can change it ${address.changesLeft} more time${address.changesLeft === 1 ? "" : "s"} in the next 12 months.`
              : "You can change it freely while you set up, then up to 2 times a year."}
        </p>
      )}

      {address.canChange && !editing && (
        <Button type="button" variant="outline" className="self-start" onClick={() => setEditing(true)}>
          Change address
        </Button>
      )}

      {editing && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-4">
          <Label htmlFor="new-address">New address</Label>
          <div className="flex items-center gap-1">
            <Input
              id="new-address"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. virgo-fidelis"
              autoComplete="off"
              autoFocus
              className="max-w-xs"
            />
            <span className="text-sm text-muted-foreground">.schoolkit.ng</span>
          </div>
          {copy && (
            <p className={cn("text-sm", copy.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
              {copy.text}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The old address keeps working, so printed result cards and links you have already shared still reach you.
            Students can sign in with either code.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={saving || check?.status !== "AVAILABLE"} onClick={() => void save()}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Use this address
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
