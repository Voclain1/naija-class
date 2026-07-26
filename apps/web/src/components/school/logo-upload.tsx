"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { uploadSchoolLogo } from "@/lib/onboarding/schools-api";

import { SchoolLogo } from "./school-logo";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — mirrors the API's limit

// Shared between the signup wizard's branding step and /settings/school.
// Uploads immediately on file selection (same "separate action, not part of
// a form submit" shape as the expense-receipt upload) — the school row
// already exists by the time either caller renders this, so there's no
// "create first, then attach" ordering problem to solve.
export function LogoUpload() {
  const { setSchool } = useAuth();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error("Logo must be a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error("This file is larger than the 2 MB limit. Please use a smaller image.");
      return;
    }

    setUploading(true);
    try {
      const updated = await uploadSchoolLogo(file);
      setSchool(updated);
      toast.success("Logo uploaded.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not upload the logo. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        <SchoolLogo className="h-full w-full object-contain" />
      </div>
      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? "Uploading…" : "Upload logo"}
        </Button>
        <span className="text-xs text-muted-foreground">PNG, JPEG, or WebP. Up to 2 MB.</span>
      </div>
    </div>
  );
}
