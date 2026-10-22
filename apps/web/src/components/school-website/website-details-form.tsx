"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  WEBSITE_ACCENTS,
  WEBSITE_ACCENT_KEYS,
  WEBSITE_BOARDING,
  WEBSITE_BOARDING_LABELS,
  WEBSITE_GENDERS,
  WEBSITE_GENDER_LABELS,
  WEBSITE_LEVELS,
  WEBSITE_LEVEL_LABELS,
  WEBSITE_LIMITS,
  type SchoolWebsiteDto,
  type WebsiteDetails,
  type WebsitePhotoDto,
  type WebsiteSection,
} from "@school-kit/types";

import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { listWebsitePhotos, saveWebsiteDraft } from "@/lib/school-website/school-website-api";

import { SectionLock } from "./section-lock";
import { WebsitePhotoUpload } from "./website-photo-upload";

const TEXTAREA = "w-full rounded-md border border-input bg-background p-2 text-sm";

// The page details (docs/modules/school-website.md): cover, about us, quick
// facts, leadership, the admissions box and the accent colour. Saved as a
// draft; families see it after Publish.
export function WebsiteDetailsForm({ site, onSaved }: { site: SchoolWebsiteDto; onSaved: (s: SchoolWebsiteDto) => void }) {
  const [d, setD] = useState<WebsiteDetails>(site.draft);
  const [photos, setPhotos] = useState<WebsitePhotoDto[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([listWebsitePhotos("COVER"), listWebsitePhotos("LEADER")])
      .then(([c, l]) => setPhotos([...c.photos, ...l.photos]))
      .catch(() => setPhotos([]));
  }, []);

  const section = (s: WebsiteSection) => site.sections.find((x) => x.section === s)!;
  const set = <K extends keyof WebsiteDetails>(key: K, value: WebsiteDetails[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const text = (v: string) => (v.length ? v : null);
  const photo = (id: string | null) => (id ? photos.find((p) => p.id === id) : undefined);

  async function save() {
    setSaving(true);
    try {
      const next = await saveWebsiteDraft(d);
      onSaved(next);
      setD(next.draft);
      toast.success("Saved. Publish when you are ready for families to see it.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  const cover = photo(d.coverPhotoId);

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-base font-semibold">Cover and welcome</legend>
        <SectionLock state={section("details")} enforcement={site.enforcement} />
        {cover && !cover.takenDown ? (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
            <img src={cover.thumbUrl} alt="The cover photo" className="h-32 w-full max-w-md rounded-md object-cover" />
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => set("coverPhotoId", null)}>
              Remove the cover photo
            </Button>
          </div>
        ) : (
          <WebsitePhotoUpload
            kind="COVER"
            label="Choose a cover photo"
            onUploaded={(p) => {
              setPhotos((prev) => [p, ...prev]);
              set("coverPhotoId", p.id);
            }}
          />
        )}
        {cover?.takenDown && <p className="text-sm text-amber-700 dark:text-amber-400">SchoolKit took this photo down: {cover.takenDown.reason}</p>}
        <div className="flex flex-col gap-1">
          <Label htmlFor="w-welcome">Welcome line</Label>
          <Input id="w-welcome" maxLength={WEBSITE_LIMITS.welcome} value={d.welcome ?? ""} onChange={(e) => set("welcome", text(e.target.value))} placeholder="e.g. A caring Catholic school in the heart of Enugu" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-base font-semibold">About us</legend>
        <SectionLock state={section("details")} enforcement={site.enforcement} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-head-name">Head&apos;s name</Label>
            <Input id="w-head-name" maxLength={WEBSITE_LIMITS.headName} value={d.headName ?? ""} onChange={(e) => set("headName", text(e.target.value))} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-head-title">Title</Label>
            <Input id="w-head-title" maxLength={WEBSITE_LIMITS.headTitle} value={d.headTitle ?? ""} onChange={(e) => set("headTitle", text(e.target.value))} placeholder="e.g. Principal" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="w-head-welcome">A welcome from the head</Label>
          <textarea id="w-head-welcome" className={`${TEXTAREA} min-h-28`} maxLength={WEBSITE_LIMITS.headWelcome} value={d.headWelcome ?? ""} onChange={(e) => set("headWelcome", text(e.target.value))} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="w-story">Our story</Label>
          <textarea id="w-story" className={`${TEXTAREA} min-h-28`} maxLength={WEBSITE_LIMITS.story} value={d.story ?? ""} onChange={(e) => set("story", text(e.target.value))} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-base font-semibold">Quick facts</legend>
        <SectionLock state={section("details")} enforcement={site.enforcement} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-founded">Year founded</Label>
            <Input
              id="w-founded"
              inputMode="numeric"
              value={d.founded ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, "").slice(0, 4));
                set("founded", n ? n : null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-curriculum">Curriculum</Label>
            <Input id="w-curriculum" maxLength={WEBSITE_LIMITS.curriculum} value={d.curriculum ?? ""} onChange={(e) => set("curriculum", text(e.target.value))} placeholder="e.g. Nigerian and British" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-boarding">Day or boarding</Label>
            <select id="w-boarding" className={SELECT_CLASSES} value={d.boarding ?? ""} onChange={(e) => set("boarding", (e.target.value || null) as WebsiteDetails["boarding"])}>
              <option value="">Not shown</option>
              {WEBSITE_BOARDING.map((b) => (
                <option key={b} value={b}>
                  {WEBSITE_BOARDING_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="w-gender">Pupils</Label>
            <select id="w-gender" className={SELECT_CLASSES} value={d.gender ?? ""} onChange={(e) => set("gender", (e.target.value || null) as WebsiteDetails["gender"])}>
              <option value="">Not shown</option>
              {WEBSITE_GENDERS.map((g) => (
                <option key={g} value={g}>
                  {WEBSITE_GENDER_LABELS[g]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Levels taught</span>
          <div className="flex flex-wrap gap-3">
            {WEBSITE_LEVELS.map((l) => (
              <label key={l} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={d.levels.includes(l)}
                  onChange={(e) => set("levels", e.target.checked ? WEBSITE_LEVELS.filter((x) => x === l || d.levels.includes(x)) : d.levels.filter((x) => x !== l))}
                />
                {WEBSITE_LEVEL_LABELS[l]}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-base font-semibold">Leadership</legend>
        <SectionLock state={section("leaders")} enforcement={site.enforcement} />
        <p className="text-sm text-muted-foreground">Up to {site.limits.leaders || WEBSITE_LIMITS.leaders} people, shown in this order. Adults only in photos.</p>
        {d.leaders.map((leader, i) => {
          const p = photo(leader.photoId);
          const update = (patch: Partial<typeof leader>) => set("leaders", d.leaders.map((l, j) => (j === i ? { ...l, ...patch } : l)));
          return (
            <div key={i} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input aria-label="Name" placeholder="Name" maxLength={WEBSITE_LIMITS.leaderName} value={leader.name} onChange={(e) => update({ name: e.target.value })} />
                <Input aria-label="Role" placeholder="Role, e.g. Proprietress" maxLength={WEBSITE_LIMITS.leaderRole} value={leader.role} onChange={(e) => update({ role: e.target.value })} />
              </div>
              {p && !p.takenDown ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
                  <img src={p.thumbUrl} alt="" className="h-14 w-14 rounded-full object-cover" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => update({ photoId: null })}>
                    Remove photo
                  </Button>
                </div>
              ) : (
                <WebsitePhotoUpload
                  kind="LEADER"
                  label="Add their photo"
                  onUploaded={(np) => {
                    setPhotos((prev) => [np, ...prev]);
                    update({ photoId: np.id });
                  }}
                />
              )}
              <Button type="button" variant="ghost" size="sm" className="self-start text-destructive" onClick={() => set("leaders", d.leaders.filter((_, j) => j !== i))}>
                <Trash2 className="mr-1 h-4 w-4" />
                Remove {leader.name || "this person"}
              </Button>
            </div>
          );
        })}
        {d.leaders.length < WEBSITE_LIMITS.leaders && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set("leaders", [...d.leaders, { name: "", role: "", photoId: null }])}>
            Add a person
          </Button>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-base font-semibold">Admissions box</legend>
        <SectionLock state={section("admissionsBox")} enforcement={site.enforcement} />
        <p className="text-sm text-muted-foreground">Shown only while your online admissions are open, beside the Apply button.</p>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Entry classes</span>
          <div className="flex flex-wrap gap-3">
            {site.classLevels.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={d.entryClassLevelIds.includes(l.id)}
                  onChange={(e) => set("entryClassLevelIds", e.target.checked ? [...d.entryClassLevelIds, l.id] : d.entryClassLevelIds.filter((x) => x !== l.id))}
                />
                {l.name}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="w-fees">Fees range, in your own words</Label>
          <Input id="w-fees" maxLength={WEBSITE_LIMITS.feesText} value={d.feesText ?? ""} onChange={(e) => set("feesText", text(e.target.value))} placeholder="e.g. ₦180,000 – ₦250,000 a term" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="w-visit">Visit us</Label>
          <textarea id="w-visit" className={`${TEXTAREA} min-h-16`} maxLength={WEBSITE_LIMITS.visitNote} value={d.visitNote ?? ""} onChange={(e) => set("visitNote", text(e.target.value))} placeholder="e.g. Visits are welcome Monday to Friday, 9am to 2pm." />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-base font-semibold">Accent colour</legend>
        <SectionLock state={section("accent")} enforcement={site.enforcement} />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
          <button
            type="button"
            role="radio"
            aria-checked={d.accent === null}
            className={`rounded-md border px-3 py-1.5 text-sm ${d.accent === null ? "bg-muted font-medium" : ""}`}
            onClick={() => set("accent", null)}
          >
            SchoolKit green (default)
          </button>
          {WEBSITE_ACCENT_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={d.accent === k}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${d.accent === k ? "bg-muted font-medium" : ""}`}
              onClick={() => set("accent", k)}
            >
              <span className="h-4 w-4 rounded-full" style={{ background: WEBSITE_ACCENTS[k].hex }} aria-hidden />
              {WEBSITE_ACCENTS[k].label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save draft
        </Button>
        <span className="text-sm text-muted-foreground">Saving does not change the live page. Use Preview, then Publish.</span>
      </div>
    </div>
  );
}
