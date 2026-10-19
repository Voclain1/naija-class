"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  FIXED_ASSET_CATEGORY_LABELS,
  FIXED_ASSET_CONDITION_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  fixedAssetCategoryValues,
  fixedAssetStatusValues,
  type FixedAssetCategory,
  type FixedAssetListDto,
  type FixedAssetStatus,
  type FixedAssetSummaryDto,
} from "@school-kit/types";

import { EmptyState, PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { AssetFormDialog } from "@/components/store/asset-form-dialog";
import { StoreNav } from "@/components/store/store-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import type { CsvColumn } from "@/lib/csv-export";
import { formatKobo } from "@/lib/finance/format";
import { listAssets } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// /store/assets — the fixed-assets register (owner's answer 4): computers,
// projectors, furniture, laboratory equipment and the like, where each one is,
// who has it, and its condition.

const COLUMNS: CsvColumn<FixedAssetSummaryDto>[] = [
  { header: "Tag", accessor: (a) => a.tag },
  { header: "Asset", accessor: (a) => a.name },
  { header: "Category", accessor: (a) => FIXED_ASSET_CATEGORY_LABELS[a.category] },
  { header: "Location", accessor: (a) => a.location },
  { header: "Assigned to", accessor: (a) => a.assignedTo },
  { header: "Condition", accessor: (a) => FIXED_ASSET_CONDITION_LABELS[a.condition] },
  { header: "Status", accessor: (a) => FIXED_ASSET_STATUS_LABELS[a.status] },
  { header: "Bought", accessor: (a) => a.purchaseDate },
  { header: "Cost (₦)", accessor: (a) => (a.purchaseCost === null ? "" : (a.purchaseCost / 100).toFixed(2)) },
];

export default function AssetsPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "asset.manage");
  const [list, setList] = useState<FixedAssetListDto | null>(null);
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [category, setCategory] = useState<FixedAssetCategory | "">("");
  const [status, setStatus] = useState<FixedAssetStatus | "">("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await listAssets({ q: applied || undefined, category: category || undefined, status: status || undefined }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the register.");
    }
  }, [applied, category, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = Boolean(applied || category || status);
  const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Assets"
        subtitle="The school's equipment and furniture: where each item is, who has it and what state it is in."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListExportMenu title="Asset register" csvFilename="asset-register.csv" columns={COLUMNS} getRows={() => list?.data ?? []} disabled={!list?.data.length} />
            {canManage && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Add asset
              </Button>
            )}
          </div>
        }
      />
      <StoreNav />

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <form
          className="flex flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q.trim());
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="asset-q" className="text-sm font-medium">
              Find an asset
            </label>
            <Input id="asset-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tag, name, place or serial number" />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as FixedAssetCategory | "")} className={select}>
            <option value="">All categories</option>
            {fixedAssetCategoryValues.map((c) => (
              <option key={c} value={c}>
                {FIXED_ASSET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as FixedAssetStatus | "")} className={select}>
            <option value="">Everything not disposed</option>
            {fixedAssetStatusValues.map((s) => (
              <option key={s} value={s}>
                {FIXED_ASSET_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {list && list.data.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {list.data.length} asset{list.data.length === 1 ? "" : "s"} · bought for {formatKobo(list.totalCost)} in all
        </p>
      )}

      {list === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={filtered ? "No assets match" : "The register is empty"}
          body={filtered ? "Try clearing the search or the filters." : "Add the school's computers, projectors, furniture and equipment, one tag number each."}
          action={canManage && !filtered ? <Button onClick={() => setAdding(true)}>Add asset</Button> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Asset</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Assigned to</th>
                <th className="px-3 py-2">Condition</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.data.map((a) => (
                <tr key={a.id} className={cn((a.condition === "POOR" || a.condition === "BROKEN") && "bg-amber-50 dark:bg-amber-950/30")}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/store/assets/${a.id}`} className="hover:underline">
                      {a.tag}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/store/assets/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{FIXED_ASSET_CATEGORY_LABELS[a.category]}</span>
                  </td>
                  <td className="px-3 py-2">{a.location ?? "—"}</td>
                  <td className="px-3 py-2">{a.assignedTo ?? "—"}</td>
                  <td className="px-3 py-2">{FIXED_ASSET_CONDITION_LABELS[a.condition]}</td>
                  <td className="px-3 py-2">{FIXED_ASSET_STATUS_LABELS[a.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AssetFormDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(asset) => {
          setAdding(false);
          router.push(`/store/assets/${asset.id}`);
        }}
      />
    </div>
  );
}
