"use client";

import {
  Loader2,
  PlusCircle,
  Search,
  Star,
  StarOff,
  Unlink,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  RELATIONSHIP_VALUES,
  type CreateAndLinkGuardianInput,
  type GuardianDto,
  type RelationshipDto,
  type StudentGuardianRefDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createAndLinkGuardian,
  linkExistingGuardian,
  listGuardians,
  unlinkStudentGuardian,
  updateStudentGuardianLink,
} from "@/lib/guardians/guardians-api";
import { cn } from "@/lib/utils";

interface Props {
  studentId: string;
  guardians: StudentGuardianRefDto[];
  onGuardiansChanged: (next: StudentGuardianRefDto[]) => void;
}

const RELATIONSHIP_LABELS: Record<RelationshipDto, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  OTHER: "Other",
};

// Guardians-tab landing — list + add. Slice 5 cp2.
//
// Admin UI: phones shown in full (NOT redacted — admins need to call
// guardians). The redactor (apps/api/src/observability/redact.ts) still
// masks phones in logs/Sentry; this is the only authorised view path.
export function GuardiansTab({ studentId, guardians, onGuardiansChanged }: Props) {
  const [showAdd, setShowAdd] = useState(false);

  const guardiansSorted = [...guardians].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`);
  });

  return (
    <div className="flex flex-col gap-4">
      {guardiansSorted.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">No guardians yet</p>
          <p className="text-sm text-muted-foreground">
            Add the parent or guardian responsible for this student.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {guardiansSorted.map((g) => (
            <GuardianRow
              key={g.linkId}
              guardian={g}
              guardians={guardians}
              onGuardiansChanged={onGuardiansChanged}
            />
          ))}
        </ul>
      )}

      {showAdd ? (
        <AddGuardianPanel
          studentId={studentId}
          existingLinkedIds={guardians.map((g) => g.id)}
          onCancel={() => setShowAdd(false)}
          onLinked={(refs) => {
            onGuardiansChanged(refs);
            setShowAdd(false);
          }}
          currentGuardians={guardians}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowAdd(true)}
          className="w-fit"
        >
          <PlusCircle className="mr-1 h-4 w-4" />
          Add guardian
        </Button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// GuardianRow — primary star toggle, canPickup toggle, unlink button.
// All mutations are optimistic and roll back on error.
// -------------------------------------------------------------------------

interface GuardianRowProps {
  guardian: StudentGuardianRefDto;
  guardians: StudentGuardianRefDto[];
  onGuardiansChanged: (next: StudentGuardianRefDto[]) => void;
}

function GuardianRow({
  guardian,
  guardians,
  onGuardiansChanged,
}: GuardianRowProps) {
  const [busy, setBusy] = useState<null | "primary" | "pickup" | "unlink">(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const onPromote = useCallback(async () => {
    if (guardian.isPrimary || busy) return;
    setBusy("primary");
    // Optimistic: this row becomes primary, all others on the same student
    // demoted. Matches the server's auto-demote inside the same transaction
    // (apps/api/src/modules/guardians/guardians.service.ts demoteOtherPrimaries).
    const previous = guardians;
    const optimistic = guardians.map((g) => ({
      ...g,
      isPrimary: g.linkId === guardian.linkId,
    }));
    onGuardiansChanged(optimistic);
    try {
      await updateStudentGuardianLink(guardian.linkId, { isPrimary: true });
      toast.success(`${guardian.firstName} ${guardian.lastName} is now primary.`);
    } catch (e) {
      onGuardiansChanged(previous);
      toast.error(
        e instanceof ApiError ? e.message : "Could not promote guardian.",
      );
    } finally {
      setBusy(null);
    }
  }, [busy, guardian, guardians, onGuardiansChanged]);

  const onTogglePickup = useCallback(async () => {
    if (busy) return;
    const next = !guardian.canPickup;
    setBusy("pickup");
    const previous = guardians;
    const optimistic = guardians.map((g) =>
      g.linkId === guardian.linkId ? { ...g, canPickup: next } : g,
    );
    onGuardiansChanged(optimistic);
    try {
      await updateStudentGuardianLink(guardian.linkId, { canPickup: next });
    } catch (e) {
      onGuardiansChanged(previous);
      toast.error(
        e instanceof ApiError ? e.message : "Could not update pickup permission.",
      );
    } finally {
      setBusy(null);
    }
  }, [busy, guardian, guardians, onGuardiansChanged]);

  const onUnlink = useCallback(async () => {
    if (busy) return;
    setBusy("unlink");
    const previous = guardians;
    const optimistic = guardians.filter((g) => g.linkId !== guardian.linkId);
    onGuardiansChanged(optimistic);
    try {
      await unlinkStudentGuardian(guardian.linkId);
      toast.success(
        `${guardian.firstName} ${guardian.lastName} unlinked from this student.`,
      );
    } catch (e) {
      onGuardiansChanged(previous);
      toast.error(
        e instanceof ApiError ? e.message : "Could not unlink guardian.",
      );
    } finally {
      setBusy(null);
      setConfirmUnlink(false);
    }
  }, [busy, guardian, guardians, onGuardiansChanged]);

  return (
    <li className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {guardian.firstName} {guardian.lastName}
          </span>
          <span className="text-xs text-muted-foreground">
            {RELATIONSHIP_LABELS[guardian.relationship as RelationshipDto] ??
              guardian.relationship}
          </span>
          {guardian.isPrimary && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              <Star className="h-3 w-3 fill-current" />
              Primary
            </span>
          )}
        </div>
        <span className="font-mono text-sm text-muted-foreground">
          {guardian.phone}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPromote}
          disabled={guardian.isPrimary || busy !== null}
          title={guardian.isPrimary ? "Already primary" : "Make primary"}
        >
          {busy === "primary" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : guardian.isPrimary ? (
            <Star className="h-4 w-4 fill-current text-amber-500" />
          ) : (
            <StarOff className="h-4 w-4" />
          )}
          {guardian.isPrimary ? "Primary" : "Make primary"}
        </Button>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={guardian.canPickup}
            onChange={onTogglePickup}
            disabled={busy !== null}
            className="h-4 w-4 cursor-pointer"
          />
          Can pick up
          {busy === "pickup" && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </label>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmUnlink(true)}
          disabled={busy !== null}
          className="text-rose-700 hover:bg-rose-50"
        >
          <Unlink className="mr-1 h-4 w-4" />
          Unlink
        </Button>
      </div>

      {confirmUnlink && (
        <ConfirmUnlinkDialog
          guardianName={`${guardian.firstName} ${guardian.lastName}`}
          submitting={busy === "unlink"}
          onCancel={() => setConfirmUnlink(false)}
          onConfirm={onUnlink}
        />
      )}
    </li>
  );
}

// -------------------------------------------------------------------------
// AddGuardianPanel — toggle between Link-existing and Create-new modes.
// -------------------------------------------------------------------------

interface AddGuardianPanelProps {
  studentId: string;
  existingLinkedIds: string[];
  currentGuardians: StudentGuardianRefDto[];
  onCancel: () => void;
  onLinked: (next: StudentGuardianRefDto[]) => void;
}

type AddMode = "existing" | "new";

function AddGuardianPanel({
  studentId,
  existingLinkedIds,
  currentGuardians,
  onCancel,
  onLinked,
}: AddGuardianPanelProps) {
  const [mode, setMode] = useState<AddMode>("existing");

  return (
    <section className="flex flex-col gap-4 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Add guardian</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex gap-1 border-b" role="tablist">
        {(["existing", "new"] as AddMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              mode === m
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "existing" ? "Link existing" : "Create new"}
          </button>
        ))}
      </nav>

      {mode === "existing" ? (
        <LinkExistingForm
          studentId={studentId}
          existingLinkedIds={existingLinkedIds}
          currentGuardians={currentGuardians}
          onLinked={onLinked}
        />
      ) : (
        <CreateAndLinkForm
          studentId={studentId}
          currentGuardians={currentGuardians}
          onLinked={onLinked}
        />
      )}
    </section>
  );
}

// -------------------------------------------------------------------------
// LinkExistingForm — search + pick + link.
// -------------------------------------------------------------------------

function LinkExistingForm({
  studentId,
  existingLinkedIds,
  currentGuardians,
  onLinked,
}: {
  studentId: string;
  existingLinkedIds: string[];
  currentGuardians: StudentGuardianRefDto[];
  onLinked: (next: StudentGuardianRefDto[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GuardianDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<GuardianDto | null>(null);
  const [isPrimary, setIsPrimary] = useState(false);
  const [canPickup, setCanPickup] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const debounce = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (search.trim().length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await listGuardians({ search: search.trim(), limit: 10 });
        setResults(res.data);
      } catch (e) {
        toast.error(
          e instanceof ApiError ? e.message : "Could not search guardians.",
        );
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [search]);

  async function onLink() {
    if (!picked) return;
    setSubmitting(true);
    try {
      const res = await linkExistingGuardian(studentId, {
        guardianId: picked.id,
        isPrimary,
        canPickup,
      });
      const ref: StudentGuardianRefDto = {
        id: res.guardian.id,
        linkId: res.link.id,
        firstName: res.guardian.firstName,
        lastName: res.guardian.lastName,
        relationship: res.guardian.relationship,
        phone: res.guardian.phone,
        isPrimary: res.link.isPrimary,
        canPickup: res.link.canPickup,
      };
      // If this link is primary, reflect the auto-demote on the existing
      // guardians too — the server already cleared them.
      const next = isPrimary
        ? [...currentGuardians.map((g) => ({ ...g, isPrimary: false })), ref]
        : [...currentGuardians, ref];
      onLinked(next);
      toast.success("Guardian linked.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "GUARDIAN_ALREADY_LINKED") {
        toast.error("This guardian is already linked to this student.");
      } else {
        toast.error(
          e instanceof ApiError ? e.message : "Could not link guardian.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const filteredResults = results.filter(
    (g) => !existingLinkedIds.includes(g.id),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="guardian-search">Search by name or phone</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="guardian-search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPicked(null);
            }}
            placeholder="Adekunle, 08012345678…"
            className="pl-9"
            autoFocus
          />
        </div>
      </div>

      {search.trim().length > 0 && (
        <div className="rounded-md border bg-muted/20 p-2">
          {searching ? (
            <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : filteredResults.length === 0 ? (
            <p className="px-2 py-1 text-sm text-muted-foreground">
              No matching guardians.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filteredResults.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(g)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                      picked?.id === g.id && "bg-accent",
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {g.firstName} {g.lastName}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {g.phone}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {RELATIONSHIP_LABELS[g.relationship as RelationshipDto] ??
                        g.relationship}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {picked && (
        <>
          <div className="flex flex-col gap-2 rounded-md border bg-background p-3 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Selected
            </span>
            <span className="font-medium">
              {picked.firstName} {picked.lastName}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {picked.phone}
            </span>
          </div>

          <LinkFlags
            isPrimary={isPrimary}
            canPickup={canPickup}
            onIsPrimaryChange={setIsPrimary}
            onCanPickupChange={setCanPickup}
            idPrefix="link"
          />

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={onLink}
              disabled={submitting}
              className="flex-1"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Link guardian
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------
// CreateAndLinkForm — full guardian-fields form + link flags. Calls
// POST /students/:studentId/guardians/new (one transaction on the server).
// -------------------------------------------------------------------------

interface CreateFormValues {
  firstName: string;
  lastName: string;
  relationship: RelationshipDto | "";
  phone: string;
  email: string;
  occupation: string;
  employer: string;
  address: string;
  notes: string;
  isPrimary: boolean;
  canPickup: boolean;
}

function emptyValues(): CreateFormValues {
  return {
    firstName: "",
    lastName: "",
    relationship: "",
    phone: "",
    email: "",
    occupation: "",
    employer: "",
    address: "",
    notes: "",
    isPrimary: false,
    canPickup: true,
  };
}

function CreateAndLinkForm({
  studentId,
  currentGuardians,
  onLinked,
}: {
  studentId: string;
  currentGuardians: StudentGuardianRefDto[];
  onLinked: (next: StudentGuardianRefDto[]) => void;
}) {
  const [values, setValues] = useState<CreateFormValues>(emptyValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof CreateFormValues>(
    key: K,
    value: CreateFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const { [key as string]: _ignored, ...rest } = e;
      return rest;
    });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.firstName.trim()) next.firstName = "First name is required.";
    if (!values.lastName.trim()) next.lastName = "Last name is required.";
    if (!values.relationship) next.relationship = "Pick a relationship.";
    if (!values.phone.trim()) next.phone = "Phone is required.";
    if (values.email.trim() && !values.email.includes("@")) {
      next.email = "Enter a valid email.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload: CreateAndLinkGuardianInput = {
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        relationship: values.relationship as RelationshipDto,
        phone: values.phone.trim(),
        email: values.email.trim() === "" ? undefined : values.email.trim(),
        occupation:
          values.occupation.trim() === "" ? undefined : values.occupation.trim(),
        employer:
          values.employer.trim() === "" ? undefined : values.employer.trim(),
        address: values.address.trim() === "" ? undefined : values.address.trim(),
        notes: values.notes.trim() === "" ? undefined : values.notes.trim(),
        isPrimary: values.isPrimary,
        canPickup: values.canPickup,
      };
      const res = await createAndLinkGuardian(studentId, payload);
      const ref: StudentGuardianRefDto = {
        id: res.guardian.id,
        linkId: res.link.id,
        firstName: res.guardian.firstName,
        lastName: res.guardian.lastName,
        relationship: res.guardian.relationship,
        phone: res.guardian.phone,
        isPrimary: res.link.isPrimary,
        canPickup: res.link.canPickup,
      };
      const next = values.isPrimary
        ? [...currentGuardians.map((g) => ({ ...g, isPrimary: false })), ref]
        : [...currentGuardians, ref];
      onLinked(next);
      toast.success("Guardian created and linked.");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not create guardian.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-firstName">First name</Label>
          <Input
            id="g-firstName"
            value={values.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            aria-invalid={Boolean(errors.firstName)}
          />
          {errors.firstName && (
            <p className="text-sm text-destructive">{errors.firstName}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-lastName">Last name</Label>
          <Input
            id="g-lastName"
            value={values.lastName}
            onChange={(e) => update("lastName", e.target.value)}
            aria-invalid={Boolean(errors.lastName)}
          />
          {errors.lastName && (
            <p className="text-sm text-destructive">{errors.lastName}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-relationship">Relationship</Label>
          <select
            id="g-relationship"
            value={values.relationship}
            onChange={(e) =>
              update("relationship", e.target.value as RelationshipDto | "")
            }
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-invalid={Boolean(errors.relationship)}
          >
            <option value="">Select…</option>
            {RELATIONSHIP_VALUES.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </select>
          {errors.relationship && (
            <p className="text-sm text-destructive">{errors.relationship}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-phone">Phone</Label>
          <Input
            id="g-phone"
            type="tel"
            value={values.phone}
            onChange={(e) => update("phone", e.target.value)}
            placeholder="08012345678"
            aria-invalid={Boolean(errors.phone)}
          />
          {errors.phone && (
            <p className="text-sm text-destructive">{errors.phone}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-email">Email (optional)</Label>
          <Input
            id="g-email"
            type="email"
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-occupation">Occupation (optional)</Label>
          <Input
            id="g-occupation"
            value={values.occupation}
            onChange={(e) => update("occupation", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="g-employer">Employer (optional)</Label>
          <Input
            id="g-employer"
            value={values.employer}
            onChange={(e) => update("employer", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="g-address">Address (optional)</Label>
          <Input
            id="g-address"
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="g-notes">Notes (optional)</Label>
          <textarea
            id="g-notes"
            rows={2}
            value={values.notes}
            onChange={(e) => update("notes", e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
      </div>

      <LinkFlags
        isPrimary={values.isPrimary}
        canPickup={values.canPickup}
        onIsPrimaryChange={(v) => update("isPrimary", v)}
        onCanPickupChange={(v) => update("canPickup", v)}
        idPrefix="create"
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="flex-1">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          <UserPlus className="mr-1 h-4 w-4" />
          Create and link
        </Button>
      </div>
    </form>
  );
}

function LinkFlags({
  isPrimary,
  canPickup,
  onIsPrimaryChange,
  onCanPickupChange,
  idPrefix,
}: {
  isPrimary: boolean;
  canPickup: boolean;
  onIsPrimaryChange: (v: boolean) => void;
  onCanPickupChange: (v: boolean) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-4 rounded-md border bg-muted/20 p-3">
      <label
        htmlFor={`${idPrefix}-isPrimary`}
        className="flex cursor-pointer items-center gap-2 text-sm"
      >
        <input
          id={`${idPrefix}-isPrimary`}
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => onIsPrimaryChange(e.target.checked)}
          className="h-4 w-4 cursor-pointer"
        />
        Set as primary guardian
      </label>
      <label
        htmlFor={`${idPrefix}-canPickup`}
        className="flex cursor-pointer items-center gap-2 text-sm"
      >
        <input
          id={`${idPrefix}-canPickup`}
          type="checkbox"
          checked={canPickup}
          onChange={(e) => onCanPickupChange(e.target.checked)}
          className="h-4 w-4 cursor-pointer"
        />
        Allowed to pick up
      </label>
    </div>
  );
}

// -------------------------------------------------------------------------
// Confirm-unlink dialog — Tailwind overlay + Escape handler. Matches the
// StudentStatusActions confirm-dialog shape.
// -------------------------------------------------------------------------

function ConfirmUnlinkDialog({
  guardianName,
  submitting,
  onCancel,
  onConfirm,
}: {
  guardianName: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlink-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h2 id="unlink-dialog-title" className="text-lg font-semibold">
          Unlink guardian
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {guardianName} will no longer be linked to this student. The
          guardian record itself is preserved and can be re-linked later.
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Unlinking…" : "Unlink"}
          </Button>
        </div>
      </div>
    </div>
  );
}
