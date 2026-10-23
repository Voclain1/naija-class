"use client";

import { Loader2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { WEBSITE_NO_PUPILS_TICK, WEBSITE_PHOTO_RULE, type WebsitePhotoDto, type WebsitePhotoKind } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { prepareWebsitePhoto } from "@/lib/school-website/resize";
import { uploadWebsitePhoto } from "@/lib/school-website/school-website-api";

// One upload control for every website photo (docs/modules/school-website.md
// W4): the "This photo shows no pupils" tick must be given before a file can
// be chosen, and the rule is written beside it. The browser resizes the photo
// and strips its location data before it leaves the computer.
export function WebsitePhotoUpload({
  kind,
  postId,
  albumId,
  label = "Add a photo",
  disabled,
  onUploaded,
}: {
  kind: WebsitePhotoKind;
  postId?: string;
  albumId?: string;
  label?: string;
  disabled?: boolean;
  onUploaded: (photo: WebsitePhotoDto) => void;
}) {
  const tickId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const prepared = await prepareWebsitePhoto(file);
      const photo = await uploadWebsitePhoto(prepared, { kind, postId, albumId });
      onUploaded(photo);
      setTicked(false);
      toast.success("Photo added.");
    } catch (e) {
      toast.error(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't add the photo — try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{WEBSITE_PHOTO_RULE}</p>
      <label htmlFor={tickId} className="flex items-start gap-2 text-sm">
        <input id={tickId} type="checkbox" className="mt-1" checked={ticked} disabled={disabled || busy} onChange={(e) => setTicked(e.target.checked)} />
        <span className="font-medium">{WEBSITE_NO_PUPILS_TICK}</span>
      </label>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        data-testid="website-photo-file"
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={!ticked || disabled || busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
        {label}
      </Button>
    </div>
  );
}
