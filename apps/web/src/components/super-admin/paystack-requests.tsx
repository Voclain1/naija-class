"use client";

import { useState } from "react";
import { toast } from "sonner";

import { paystackSetupStatusLabel } from "@school-kit/types";
import type {
  PlatformAdminPaystackSetupRequestDto,
  PlatformAdminPaystackSetupRevealDto,
  PlatformAdminResolvePaystackSetupInput,
  PlatformAdminResolvePaystackSetupResponse,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, proxyFetch } from "@/lib/api-client";

import { usePlatformLoad } from "./platform-load";

// Paystack assisted setup (2026-08-15): schools waiting on a subaccount.
// `revealed` is keyed by requestId and deliberately NOT prefetched with the
// list — every reveal is a separate audited server call, so banking details
// only exist in this browser's memory for rows the operator explicitly opened.
// Moved out of the single-page dashboard in the 2026-10-30 console redesign.
export function PaystackRequestsCard() {
  const [setupRequests, , , refreshSetupRequests] = usePlatformLoad<
    PlatformAdminPaystackSetupRequestDto[]
  >(
    "/api/platform-admin/paystack-setup-requests",
    "Could not load setup requests.",
  );
  const [revealed, setRevealed] = useState<
    Record<string, PlatformAdminPaystackSetupRevealDto>
  >({});
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);

  // Separate, individually-audited server call — see the reveal endpoint's
  // comment. Not prefetched, and not cached beyond this page view.
  const onReveal = async (requestId: string) => {
    setRevealingId(requestId);
    try {
      const res = await proxyFetch<PlatformAdminPaystackSetupRevealDto>(
        `/api/platform-admin/paystack-setup-requests/${requestId}/reveal`,
      );
      setRevealed((current) => ({ ...current, [requestId]: res }));
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not reveal details.",
      );
    } finally {
      setRevealingId(null);
    }
  };

  const onResolveSetup = async (
    requestId: string,
    input: PlatformAdminResolvePaystackSetupInput,
  ) => {
    setResolvingId(requestId);
    try {
      await proxyFetch<PlatformAdminResolvePaystackSetupResponse>(
        `/api/platform-admin/paystack-setup-requests/${requestId}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
      toast.success(
        input.status === "FULFILLED"
          ? "Marked fulfilled — the verified subaccount and split are now connected."
          : "Request rejected. The school sees your reason.",
      );
      // Drop the revealed banking details as soon as the request is closed.
      setRevealed((current) => {
        const next = { ...current };
        delete next[requestId];
        return next;
      });
      refreshSetupRequests();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not update the request.",
      );
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pending Paystack setup requests</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowResolved((v) => !v)}
        >
          {showResolved ? "Hide resolved" : "Show resolved"}
        </Button>
      </CardHeader>
      <CardContent>
        {setupRequests === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          (() => {
            const visible = showResolved
              ? setupRequests
              : setupRequests.filter((r) => r.status === "PENDING");
            if (visible.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  {showResolved
                    ? "No setup requests yet."
                    : "No schools waiting on a Paystack subaccount."}
                </p>
              );
            }
            return (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School</TableHead>
                    <TableHead>Business name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((r) => {
                    const details = revealed[r.requestId];
                    return (
                      <TableRow key={r.requestId}>
                        <TableCell>{r.schoolName}</TableCell>
                        <TableCell>{r.businessName}</TableCell>
                        <TableCell>{r.contactName}</TableCell>
                        <TableCell>
                          {new Date(r.submittedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "PENDING" ? "default" : "secondary"
                            }
                          >
                            {paystackSetupStatusLabel[r.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.status !== "PENDING" ? null : details ? (
                            <div className="flex flex-col gap-2">
                              <div className="rounded-md border bg-muted/40 p-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">
                                    Bank:{" "}
                                  </span>
                                  {details.bankName}
                                </div>
                                <div className="font-mono">
                                  <span className="font-sans text-muted-foreground">
                                    Account:{" "}
                                  </span>
                                  {details.accountNumber}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Name:{" "}
                                  </span>
                                  {details.accountName}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Email:{" "}
                                  </span>
                                  {details.contactEmail}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Phone:{" "}
                                  </span>
                                  {details.contactPhone}
                                </div>
                              </div>
                              <Input
                                value={codeDrafts[r.requestId] ?? ""}
                                onChange={(e) =>
                                  setCodeDrafts((c) => ({
                                    ...c,
                                    [r.requestId]: e.target.value,
                                  }))
                                }
                                placeholder="ACCT_xxxxxxxxxx"
                                className="h-8 font-mono text-xs"
                                aria-label={`Subaccount code for ${r.schoolName}`}
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={
                                    resolvingId === r.requestId ||
                                    !(codeDrafts[r.requestId] ?? "").trim()
                                  }
                                  onClick={() =>
                                    onResolveSetup(r.requestId, {
                                      status: "FULFILLED",
                                      subaccountCode: (
                                        codeDrafts[r.requestId] ?? ""
                                      ).trim(),
                                    })
                                  }
                                >
                                  Mark fulfilled
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={resolvingId === r.requestId}
                                  onClick={() => {
                                    const reason = window.prompt(
                                      "Why is this request being rejected? The school will see this.",
                                    );
                                    if (reason?.trim()) {
                                      void onResolveSetup(r.requestId, {
                                        status: "REJECTED",
                                        notes: reason.trim(),
                                      });
                                    }
                                  }}
                                >
                                  Reject
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={revealingId === r.requestId}
                              onClick={() => onReveal(r.requestId)}
                            >
                              {revealingId === r.requestId
                                ? "Revealing…"
                                : "Reveal details"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}
