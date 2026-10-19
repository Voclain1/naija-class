"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/use-auth";
import { staffPhotoUrls } from "@/lib/photos/photos-api";

import { PhotoField } from "./photo-field";

// "My profile": your own passport photo, for your staff ID card. Everyone
// may set their own (the /users/me/photo routes).
export function OwnPhotoSection() {
  const { user } = useAuth();
  const [hasPhoto, setHasPhoto] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    staffPhotoUrls([user.id])
      .then(({ urls }) => live && setHasPhoto(Boolean(urls[user.id])))
      .catch(() => live && setHasPhoto(false));
    return () => {
      live = false;
    };
  }, [user]);

  if (!user) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">My photo</h2>
      <div className="rounded-md border bg-card p-4">
        {hasPhoto === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <PhotoField
            kind="staff"
            id={user.id}
            own
            name={`${user.firstName} ${user.lastName}`}
            hasPhoto={hasPhoto}
            canEdit
            onChange={setHasPhoto}
          />
        )}
      </div>
    </section>
  );
}
