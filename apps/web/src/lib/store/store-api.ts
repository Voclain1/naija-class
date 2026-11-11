import type {
  ClassSalePreviewDto,
  ClassSaleResultDto,
  CollectStoreOrderInput,
  CreateClassSaleInput,
  CreateStoreOrderInput,
  PreviewClassSaleInput,
  PreviewStoreOrderInput,
  StoreOrderPreviewDto,
  SavePackInput,
  StoreCheckoutContextDto,
  StoreOrderDto,
  StoreOrderSummaryDto,
  StorePackDto,
  StoreTakingsReportDto,
  UpdateStoreSettingsInput,
  StoreSettingsDto,
  AddStoreVariantInput,
  CreateFixedAssetInput,
  CreateStoreItemInput,
  DisposeFixedAssetInput,
  FixedAssetCategory,
  FixedAssetDto,
  FixedAssetListDto,
  FixedAssetStatus,
  RecordStoreMovementInput,
  StoreCategory,
  StoreItemDto,
  StoreItemSummaryDto,
  StoreMovementDto,
  StoreMovementKind,
  StorePersonDto,
  StoreSalesReportDto,
  StoreStockReportDto,
  StoreStockTakeDto,
  StoreStockTakeSummaryDto,
  UpdateFixedAssetInput,
  UpdateStoreItemInput,
  UpdateStoreVariantInput,
} from "@school-kit/types";

import { apiFetch } from "@/lib/api-client";

// The Store and the asset register (docs/modules/id-cards-and-store.md §4).

const id = (value: string) => encodeURIComponent(value);
const query = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

export const listStoreItems = (params: { q?: string; category?: StoreCategory; low?: boolean; includeInactive?: boolean } = {}) =>
  apiFetch<StoreItemSummaryDto[]>(
    `/store/items${query({
      q: params.q,
      category: params.category,
      low: params.low ? "true" : undefined,
      includeInactive: params.includeInactive ? "true" : undefined,
    })}`,
    { method: "GET" },
  );
export const getStoreItem = (itemId: string) => apiFetch<StoreItemDto>(`/store/items/${id(itemId)}`, { method: "GET" });
export const createStoreItem = (body: CreateStoreItemInput) =>
  apiFetch<StoreItemDto>("/store/items", { method: "POST", body });
export const updateStoreItem = (itemId: string, body: UpdateStoreItemInput) =>
  apiFetch<StoreItemDto>(`/store/items/${id(itemId)}`, { method: "PATCH", body });
export const addStoreVariant = (itemId: string, body: AddStoreVariantInput) =>
  apiFetch<StoreItemDto>(`/store/items/${id(itemId)}/variants`, { method: "POST", body });
export const updateStoreVariant = (variantId: string, body: UpdateStoreVariantInput) =>
  apiFetch<StoreItemDto>(`/store/variants/${id(variantId)}`, { method: "PATCH", body });

export const recordStoreMovement = (body: RecordStoreMovementInput) =>
  apiFetch<StoreMovementDto>("/store/movements", { method: "POST", body });
export const listStoreMovements = (params: { from?: string; to?: string; kind?: StoreMovementKind; itemId?: string } = {}) =>
  apiFetch<StoreMovementDto[]>(`/store/movements${query(params)}`, { method: "GET" });
export const findStorePeople = (kind: "STUDENT" | "STAFF", q: string) =>
  apiFetch<StorePersonDto[]>(`/store/people${query({ kind, q })}`, { method: "GET" });

export const listStockTakes = () => apiFetch<StoreStockTakeSummaryDto[]>("/store/stock-takes", { method: "GET" });
export const getStockTake = (takeId: string) => apiFetch<StoreStockTakeDto>(`/store/stock-takes/${id(takeId)}`, { method: "GET" });
export const startStockTake = (note?: string) =>
  apiFetch<StoreStockTakeDto>("/store/stock-takes", { method: "POST", body: { note: note ?? null } });
export const saveStockTakeCounts = (takeId: string, counts: { lineId: string; counted: number | null }[]) =>
  apiFetch<StoreStockTakeDto>(`/store/stock-takes/${id(takeId)}/counts`, { method: "PUT", body: { counts } });
export const submitStockTake = (takeId: string) =>
  apiFetch<StoreStockTakeDto>(`/store/stock-takes/${id(takeId)}/submit`, { method: "POST" });
export const approveStockTake = (takeId: string) =>
  apiFetch<StoreStockTakeDto>(`/store/stock-takes/${id(takeId)}/approve`, { method: "POST" });
export const cancelStockTake = (takeId: string) =>
  apiFetch<StoreStockTakeDto>(`/store/stock-takes/${id(takeId)}/cancel`, { method: "POST" });

export const getStockReport = () => apiFetch<StoreStockReportDto>("/store/reports/stock", { method: "GET" });
export const getSalesReport = (params: { from?: string; to?: string } = {}) =>
  apiFetch<StoreSalesReportDto>(`/store/reports/sales${query(params)}`, { method: "GET" });

export const listAssets = (params: { q?: string; category?: FixedAssetCategory; status?: FixedAssetStatus } = {}) =>
  apiFetch<FixedAssetListDto>(`/assets${query(params)}`, { method: "GET" });
export const getAsset = (assetId: string) => apiFetch<FixedAssetDto>(`/assets/${id(assetId)}`, { method: "GET" });
export const createAsset = (body: CreateFixedAssetInput) => apiFetch<FixedAssetDto>("/assets", { method: "POST", body });
export const updateAsset = (assetId: string, body: UpdateFixedAssetInput) =>
  apiFetch<FixedAssetDto>(`/assets/${id(assetId)}`, { method: "PATCH", body });
export const disposeAsset = (assetId: string, body: DisposeFixedAssetInput) =>
  apiFetch<FixedAssetDto>(`/assets/${id(assetId)}/dispose`, { method: "POST", body });

// The price list for parents: whether it is shown (2026-10-19).
export const getStoreSettings = () => apiFetch<StoreSettingsDto>("/store/settings", { method: "GET" });
export const updateStoreSettings = (body: UpdateStoreSettingsInput) =>
  apiFetch<StoreSettingsDto>("/store/settings", { method: "PUT", body });

// Store orders (2026-11-11, docs/modules/store-orders.md).
export const getCheckoutContext = () => apiFetch<StoreCheckoutContextDto>("/store/checkout", { method: "GET" });
export const previewStoreOrder = (body: PreviewStoreOrderInput) =>
  apiFetch<StoreOrderPreviewDto>("/store/orders/preview", { method: "POST", body });
export const createStoreOrder = (body: CreateStoreOrderInput) =>
  apiFetch<StoreOrderDto>("/store/orders", { method: "POST", body });
export const listStoreOrders = (
  params: { toCollect?: boolean; q?: string; from?: string; to?: string; studentId?: string; classSaleId?: string } = {},
) =>
  apiFetch<StoreOrderSummaryDto[]>(
    `/store/orders${query({ ...params, toCollect: params.toCollect ? "true" : undefined })}`,
    { method: "GET" },
  );
export const getStoreOrder = (orderId: string) => apiFetch<StoreOrderDto>(`/store/orders/${id(orderId)}`, { method: "GET" });
export const collectStoreOrder = (orderId: string, body: CollectStoreOrderInput) =>
  apiFetch<StoreOrderDto>(`/store/orders/${id(orderId)}/collect`, { method: "POST", body });
export const cancelStoreOrder = (orderId: string, reason: string) =>
  apiFetch<StoreOrderDto>(`/store/orders/${id(orderId)}/cancel`, { method: "POST", body: { reason } });

export const listPacks = (includeInactive = false) =>
  apiFetch<StorePackDto[]>(`/store/packs${query({ includeInactive: includeInactive ? "true" : undefined })}`, { method: "GET" });
export const createPack = (body: SavePackInput) => apiFetch<StorePackDto>("/store/packs", { method: "POST", body });
export const updatePack = (packId: string, body: SavePackInput) =>
  apiFetch<StorePackDto>(`/store/packs/${id(packId)}`, { method: "PUT", body });

export const previewClassSale = (body: PreviewClassSaleInput) =>
  apiFetch<ClassSalePreviewDto>("/store/class-sales/preview", { method: "POST", body });
export const createClassSale = (body: CreateClassSaleInput) =>
  apiFetch<ClassSaleResultDto>("/store/class-sales", { method: "POST", body });

export const getTakingsReport = (params: { from?: string; to?: string } = {}) =>
  apiFetch<StoreTakingsReportDto>(`/store/reports/takings${query(params)}`, { method: "GET" });
