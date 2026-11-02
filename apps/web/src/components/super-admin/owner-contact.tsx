"use client";

import { Mail, MessageCircle, Phone } from "lucide-react";
import { useEffect, useState } from "react";

import { whatsappDigits, type PlatformSchoolOwnerDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { ApiError, proxyFetch } from "@/lib/api-client";

// Who to contact at a school (2026-11-02): the owner's name, email and phone
// at the top of the Manage window's Owner section, each one a link. Email is
// always there, so a school whose phone is not on WhatsApp can still be
// reached. Read on open from GET /platform-admin/schools/:id/owner.

export function OwnerContact({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<PlatformSchoolOwnerDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    proxyFetch<PlatformSchoolOwnerDto>(`/api/platform-admin/schools/${schoolId}/owner`, { method: "GET" })
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(e instanceof ApiError ? e.message : "Could not load the owner's contact."));
    return () => {
      live = false;
    };
  }, [schoolId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading contact…</p>;
  if (!data.owner) return <p className="text-sm text-muted-foreground">No owner or owner invitation on record.</p>;

  const { name, email, phone, invitePending } = data.owner;
  const wa = whatsappDigits(phone);
  const link = "flex min-w-0 items-center gap-2 text-primary underline-offset-2 hover:underline";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-3 text-sm" data-testid="owner-contact">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {name}
        {invitePending && <Badge variant="warning">Invitation pending</Badge>}
      </p>
      <a href={`mailto:${email}`} className={link}>
        <Mail className="h-4 w-4 shrink-0" aria-hidden />
        <span className="break-all">{email}</span>
      </a>
      {phone ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <a href={`tel:${phone.replace(/\s/g, "")}`} className={link}>
            <Phone className="h-4 w-4 shrink-0" aria-hidden />
            {phone}
          </a>
          {wa && (
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className={link}>
              <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
              WhatsApp
            </a>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">No phone number on record.</p>
      )}
    </div>
  );
}
