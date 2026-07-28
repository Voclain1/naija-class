"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  inviteAdminSchema,
  type InviteAdminInput,
  type InviteAdminResponse,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { inviteAdmin } from "@/lib/users/users-api";

// Migrated onto the shared Dialog primitive (Phase 4 restyle) — was an inline
// overlay predating it (see academic-year-dialog.tsx for the same family of
// migration in Phase 3). Radix Dialog now owns focus trap, Escape-to-close,
// and backdrop click — the manual keydown listener and backdrop onClick this
// used to hand-roll are gone because Dialog already does them.
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (res: InviteAdminResponse) => void;
}

export function InviteAdminDialog({ open, onClose, onCreated }: Props) {
  const form = useForm<InviteAdminInput>({
    resolver: zodResolver(inviteAdminSchema),
    defaultValues: { email: "", firstName: "", lastName: "" },
    mode: "onSubmit",
  });

  // Reset the form whenever the dialog opens, otherwise stale values from
  // the previous invite leak into the next one.
  useEffect(() => {
    if (open) form.reset({ email: "", firstName: "", lastName: "" });
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // Strip empty optional name fields to undefined — the API schema
      // accepts the fields absent but rejects empty strings (.min(1)).
      const payload: InviteAdminInput = {
        email: values.email,
        firstName: values.firstName ? values.firstName : undefined,
        lastName: values.lastName ? values.lastName : undefined,
      };
      const res = await inviteAdmin(payload);
      toast.success("Invitation created.");
      onCreated(res);
      onClose();
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
          toast.error("Finish onboarding before inviting other admins.");
        } else {
          toast.error(error.message);
        }
      } else {
        toast.error("Could not reach the server. Try again in a moment.");
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite an admin</DialogTitle>
          <DialogDescription>
            They&apos;ll get a link to set their password and join your school.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
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

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="invite-firstName">First name (optional)</Label>
              <Input id="invite-firstName" {...form.register("firstName")} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="invite-lastName">Last name (optional)</Label>
              <Input id="invite-lastName" {...form.register("lastName")} />
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting} className="flex-1">
              {form.formState.isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {form.formState.isSubmitting ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
