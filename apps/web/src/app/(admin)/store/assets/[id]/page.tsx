"use client";

import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  FIXED_ASSET_CATEGORY_LABELS,
  FIXED_ASSET_CONDITION_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  type FixedAssetDto,
  type FixedAssetEventKind,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { AssetFormDialog } from "@/components/store/asset-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";
import { disposeAsset, getAsset } from "@/lib/store/store-api";

// /store/assets/[id] — one asset, with every move, hand-over, condition and
// status change kept below it.

const EVENT_LABELS: Record<FixedAssetEventKind, string> = {
  ADDED: "Added to the register",
  MOVED: "Moved",
  ASSIGNED: "Handed over",
  CONDITION: "Condition changed",
  STATUS: "Status changed",
  EDITED: "Details changed",
};

function today(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function AssetPage() {
  const params = useParams<{ id: string }>();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "asset.manage");
  const [asset, setAsset] = useState<FixedAssetDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [disposedOn, setDisposedOn] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAsset(params.id)
      .then(setAsset)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this asset."));
  }, [params.id]);

  async function dispose() {
    if (!asset || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setAsset(await disposeAsset(asset.id, { disposedOn, reason: reason.trim() }));
      setDisposing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not dispose of the asset.");
    } finally {
      setBusy(false);
    }
  }

  if (!asset) return error ? <InlineAlert>{error}</InlineAlert> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const live = asset.status !== "DISPOSED";

  const fields: [string, string][] = [
    ["Category", FIXED_ASSET_CATEGORY_LABELS[asset.category]],
    ["Location", asset.location ?? "—"],
    ["Assigned to", asset.assignedTo ?? "—"],
    ["Condition", FIXED_ASSET_CONDITION_LABELS[asset.condition]],
    ["Serial number", asset.serialNumber ?? "—"],
    ["Supplier", asset.supplier ?? "—"],
    ["Bought on", asset.purchaseDate ?? "—"],
    ["Cost", asset.purchaseCost === null ? "—" : formatKobo(asset.purchaseCost)],
  ];
  if (!live) fields.push(["Disposed of", `${asset.disposedAt ?? ""} — ${asset.disposalReason ?? ""}`]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/store/assets" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to assets
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight">{asset.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{asset.tag}</p>
          <Badge variant={live ? "muted" : "warning"} className="w-fit">
            {FIXED_ASSET_STATUS_LABELS[asset.status]}
          </Badge>
        </div>
        {canManage && live && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Change or move
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDisposing(true)}>
              Dispose of
            </Button>
          </div>
        )}
      </header>
      {error && <InlineAlert>{error}</InlineAlert>}

      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-md border bg-card p-4 text-sm sm:grid-cols-2">
        {fields.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
        <ul className="flex flex-col divide-y rounded-md border bg-card text-sm">
          {asset.events.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 px-4 py-3">
              <span className="font-medium">
                {EVENT_LABELS[e.kind]}
                {e.fromValue || e.toValue ? `: ${e.fromValue ?? "—"} → ${e.toValue ?? "—"}` : ""}
              </span>
              {e.note && <span>{e.note}</span>}
              <span className="text-xs text-muted-foreground">
                {new Date(e.createdAt).toLocaleString("en-NG")} · {e.createdByName}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <AssetFormDialog
        open={editing}
        asset={asset}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          setAsset(saved);
        }}
      />
      <Dialog open={disposing} onOpenChange={(next) => !next && !busy && setDisposing(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Dispose of {asset.tag}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">It stays in the register&apos;s history, marked disposed, and can no longer change.</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispose-date">Date</Label>
            <Input id="dispose-date" type="date" value={disposedOn} onChange={(e) => setDisposedOn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dispose-reason">Why</Label>
            <Input id="dispose-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Beyond repair, sold, stolen" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDisposing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void dispose()} disabled={busy || !reason.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Dispose of it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
