import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  addStoreVariantSchema,
  createFixedAssetSchema,
  createStoreItemSchema,
  disposeFixedAssetSchema,
  listFixedAssetsQuerySchema,
  listStoreItemsQuerySchema,
  listStoreMovementsQuerySchema,
  recordStoreMovementSchema,
  saveStockTakeCountsSchema,
  startStockTakeSchema,
  storePeopleQuerySchema,
  storeReportRangeQuerySchema,
  updateFixedAssetSchema,
  updateStoreItemSchema,
  updateStoreVariantSchema,
  type AddStoreVariantInput,
  type CreateFixedAssetInput,
  type CreateStoreItemInput,
  type DisposeFixedAssetInput,
  type FixedAssetDto,
  type FixedAssetListDto,
  type ListFixedAssetsQuery,
  type ListStoreItemsQuery,
  type ListStoreMovementsQuery,
  type RecordStoreMovementInput,
  type SaveStockTakeCountsInput,
  type StartStockTakeInput,
  type StoreItemDto,
  type StoreItemSummaryDto,
  type StoreMovementDto,
  type StorePeopleQuery,
  type StorePersonDto,
  type StoreReportRangeQuery,
  type StoreSalesReportDto,
  type StoreStockReportDto,
  type StoreStockTakeDto,
  type StoreStockTakeSummaryDto,
  type UpdateFixedAssetInput,
  type UpdateStoreItemInput,
  type UpdateStoreVariantInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AssetsService } from "./assets.service.js";
import { StoreService } from "./store.service.js";

// The Store and the asset register (docs/modules/id-cards-and-store.md §4).
// Routes needing one of two permissions (a sale or a stock movement, the
// people search, cancelling a stock take) carry the broader read permission
// here and the exact check in the service.

@Controller("store")
@UseGuards(AuthGuard, PermissionsGuard)
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get("items")
  @Permissions("store.read")
  listItems(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listStoreItemsQuerySchema)) query: ListStoreItemsQuery,
  ): Promise<StoreItemSummaryDto[]> {
    return this.store.listItems(authCtx, query);
  }

  @Post("items")
  @Permissions("store.manage")
  createItem(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createStoreItemSchema)) body: CreateStoreItemInput,
    @Ip() ip: string,
  ): Promise<StoreItemDto> {
    return this.store.createItem(authCtx, body, { ipAddress: ip });
  }

  @Get("items/:id")
  @Permissions("store.read")
  getItem(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<StoreItemDto> {
    return this.store.getItem(authCtx, id);
  }

  @Patch("items/:id")
  @Permissions("store.manage")
  updateItem(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStoreItemSchema)) body: UpdateStoreItemInput,
    @Ip() ip: string,
  ): Promise<StoreItemDto> {
    return this.store.updateItem(authCtx, id, body, { ipAddress: ip });
  }

  @Post("items/:id/variants")
  @Permissions("store.manage")
  addVariant(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addStoreVariantSchema)) body: AddStoreVariantInput,
    @Ip() ip: string,
  ): Promise<StoreItemDto> {
    return this.store.addVariant(authCtx, id, body, { ipAddress: ip });
  }

  @Patch("variants/:id")
  @Permissions("store.manage")
  updateVariant(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStoreVariantSchema)) body: UpdateStoreVariantInput,
    @Ip() ip: string,
  ): Promise<StoreItemDto> {
    return this.store.updateVariant(authCtx, id, body, { ipAddress: ip });
  }

  // A sale needs store.sell, every other movement store.manage (service).
  @Post("movements")
  @Permissions("store.read")
  record(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(recordStoreMovementSchema)) body: RecordStoreMovementInput,
    @Ip() ip: string,
  ): Promise<StoreMovementDto> {
    return this.store.record(authCtx, body, { ipAddress: ip });
  }

  @Get("movements")
  @Permissions("store.read")
  listMovements(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listStoreMovementsQuerySchema)) query: ListStoreMovementsQuery,
  ): Promise<StoreMovementDto[]> {
    return this.store.listMovements(authCtx, query);
  }

  // store.manage or store.sell (service).
  @Get("people")
  @Permissions("store.read")
  people(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(storePeopleQuerySchema)) query: StorePeopleQuery,
  ): Promise<StorePersonDto[]> {
    return this.store.people(authCtx, query);
  }

  @Get("stock-takes")
  @Permissions("store.read")
  listStockTakes(@CurrentUser() authCtx: AuthContext): Promise<StoreStockTakeSummaryDto[]> {
    return this.store.listStockTakes(authCtx);
  }

  @Post("stock-takes")
  @Permissions("store.manage")
  startStockTake(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(startStockTakeSchema)) body: StartStockTakeInput,
    @Ip() ip: string,
  ): Promise<StoreStockTakeDto> {
    return this.store.startStockTake(authCtx, body, { ipAddress: ip });
  }

  @Get("stock-takes/:id")
  @Permissions("store.read")
  getStockTake(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<StoreStockTakeDto> {
    return this.store.getStockTake(authCtx, id);
  }

  @Put("stock-takes/:id/counts")
  @Permissions("store.manage")
  saveCounts(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveStockTakeCountsSchema)) body: SaveStockTakeCountsInput,
  ): Promise<StoreStockTakeDto> {
    return this.store.saveCounts(authCtx, id, body);
  }

  @Post("stock-takes/:id/submit")
  @HttpCode(200)
  @Permissions("store.manage")
  submit(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<StoreStockTakeDto> {
    return this.store.submitStockTake(authCtx, id, { ipAddress: ip });
  }

  @Post("stock-takes/:id/approve")
  @HttpCode(200)
  @Permissions("store.approve")
  approve(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<StoreStockTakeDto> {
    return this.store.approveStockTake(authCtx, id, { ipAddress: ip });
  }

  // store.manage or store.approve (service).
  @Post("stock-takes/:id/cancel")
  @HttpCode(200)
  @Permissions("store.read")
  cancel(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<StoreStockTakeDto> {
    return this.store.cancelStockTake(authCtx, id, { ipAddress: ip });
  }

  @Get("reports/stock")
  @Permissions("store.read")
  stockReport(@CurrentUser() authCtx: AuthContext): Promise<StoreStockReportDto> {
    return this.store.stockReport(authCtx);
  }

  @Get("reports/sales")
  @Permissions("store.read")
  salesReport(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(storeReportRangeQuerySchema)) query: StoreReportRangeQuery,
  ): Promise<StoreSalesReportDto> {
    return this.store.salesReport(authCtx, query);
  }
}

@Controller("assets")
@UseGuards(AuthGuard, PermissionsGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @Permissions("asset.read")
  list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listFixedAssetsQuerySchema)) query: ListFixedAssetsQuery,
  ): Promise<FixedAssetListDto> {
    return this.assets.list(authCtx, query);
  }

  @Post()
  @Permissions("asset.manage")
  create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createFixedAssetSchema)) body: CreateFixedAssetInput,
    @Ip() ip: string,
  ): Promise<FixedAssetDto> {
    return this.assets.create(authCtx, body, { ipAddress: ip });
  }

  @Get(":id")
  @Permissions("asset.read")
  get(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<FixedAssetDto> {
    return this.assets.get(authCtx, id);
  }

  @Patch(":id")
  @Permissions("asset.manage")
  update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateFixedAssetSchema)) body: UpdateFixedAssetInput,
    @Ip() ip: string,
  ): Promise<FixedAssetDto> {
    return this.assets.update(authCtx, id, body, { ipAddress: ip });
  }

  @Post(":id/dispose")
  @HttpCode(200)
  @Permissions("asset.manage")
  dispose(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(disposeFixedAssetSchema)) body: DisposeFixedAssetInput,
    @Ip() ip: string,
  ): Promise<FixedAssetDto> {
    return this.assets.dispose(authCtx, id, body, { ipAddress: ip });
  }
}
