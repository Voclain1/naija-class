import { describe, expect, it, vi } from "vitest";
import type { ReminderCampaignDto, ReminderCampaignProposalDto } from "@school-kit/types";
import { ApiError, ApiNetworkError } from "@/lib/api-client";
import { DurableCampaignSession } from "./durable-session";
const proposal = (patch: Partial<ReminderCampaignProposalDto> = {}): ReminderCampaignProposalDto => ({ id: "proposal", status: "PENDING", previewHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), createdAt: new Date().toISOString(), termId: "term", termLabel: "First term", templateVersion: "v1", options: { includePaymentPlans: false, overdueOnly: false }, channels: { email: { enabled: true, configured: true }, sms: { enabled: false, configured: false, sender: "SCHOOLKIT" }, push: { enabled: false } }, counts: { selected: 1, eligible: 1, plannedSends: 1, excluded: { NOT_FOUND: 0, NO_BALANCE: 0, ON_PAYMENT_PLAN: 0, NOT_OVERDUE: 0, NO_GUARDIAN: 0, NO_CONTACT: 0, OUT_OF_SCOPE: 0 } }, students: [], batchErrors: [], batchWarnings: [], canConfirm: true, dataCleared: false, campaignId: null, limits: "Accepted is not delivery", ...patch });
const campaign = (patch: Partial<ReminderCampaignDto> = {}): ReminderCampaignDto => ({ id: "campaign", proposalId: "proposal", termId: "term", status: "RUNNING", haltReason: null, templateVersion: "v1", createdAt: new Date().toISOString(), haltedAt: null, completedAt: null, heldForQuietHours: false, counts: { PENDING: 1, SENDING: 0, ACCEPTED: 0, SKIPPED: 0, FAILED: 0, UNKNOWN: 0, NOT_REQUESTED: 0 }, students: [], limits: "Unknown is never retried", ...patch });
function fixture() {
  const api = { available: vi.fn(), prepare: vi.fn().mockResolvedValue(proposal()), proposal: vi.fn().mockResolvedValue(proposal()), confirm: vi.fn().mockResolvedValue(campaign()), refresh: vi.fn().mockResolvedValue(proposal({ id: "new-preview" })), campaign: vi.fn().mockResolvedValue(campaign()), halt: vi.fn().mockResolvedValue(campaign({ status: "HALTED" })), resume: vi.fn().mockResolvedValue(campaign()) };
  let n = 0; return { api, session: new DurableCampaignSession(api, () => `request-${++n}`) };
}
const input = { termId: "term", studentIds: ["student"], options: { includePaymentPlans: false, overdueOnly: true } };
const stale = () => new ApiError(409, { code: "REMINDER_PREVIEW_STALE", message: "Changed" });
describe("durable campaign lifecycle", () => {
  it("prepares without sending, then confirms exactly the reviewed proposal", async () => {
    const { api, session } = fixture(); await session.start(input); expect(api.confirm).not.toHaveBeenCalled(); await session.confirm(); expect(api.confirm).toHaveBeenCalledWith("proposal", "a".repeat(64)); expect(session.snapshot().campaignId).toBe("campaign");
  });
  it("retries prepare with the same client identity", async () => {
    const { api, session } = fixture(); api.prepare.mockRejectedValueOnce(new ApiNetworkError()); await session.start(input); await session.prepare(); expect(api.prepare.mock.calls[0]).toEqual(api.prepare.mock.calls[1]);
  });
  it("recovers a lost confirmation from the original proposal without preparing again", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(new ApiNetworkError()); api.proposal.mockResolvedValueOnce(proposal({ status: "CONFIRMED", campaignId: "campaign" })); await session.start(input); await session.confirm(); expect(api.proposal).toHaveBeenCalledWith("proposal"); expect(api.prepare).toHaveBeenCalledTimes(1); expect(session.snapshot().campaignId).toBe("campaign");
  });
  it("unknown confirmation blocks another confirm until the saved preview can be read", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(new ApiNetworkError()); api.proposal.mockRejectedValueOnce(new ApiNetworkError()); await session.start(input); await session.confirm(); expect(session.snapshot().phase).toBe("unknown"); await session.confirm(); expect(api.confirm).toHaveBeenCalledTimes(1); await session.check(); expect(session.snapshot().phase).toBe("review");
  });
  it("a stale preview refreshes and needs a new human confirmation", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(stale()); await session.start(input); await session.confirm(); await session.refresh(); expect(session.snapshot().proposal?.id).toBe("new-preview"); expect(api.confirm).toHaveBeenCalledTimes(1);
  });
  it("a lost refresh reuses the same request id", async () => {
    const { api, session } = fixture(); api.confirm.mockRejectedValueOnce(stale()); api.refresh.mockRejectedValueOnce(new ApiNetworkError()); await session.start(input); await session.confirm(); await session.refresh(); await session.refresh(); expect(api.refresh.mock.calls[0]).toEqual(api.refresh.mock.calls[1]);
  });
  it("reopens saved campaigns without an availability call or new proposal", async () => {
    const { api, session } = fixture(); await session.loadCampaign("saved"); expect(api.campaign).toHaveBeenCalledWith("saved"); expect(api.available).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled();
  });
  it("recovers status after a lost halt response, rather than assuming it stopped", async () => {
    const { api, session } = fixture(); await session.loadCampaign("campaign"); api.halt.mockRejectedValueOnce(new ApiNetworkError()); await session.act("halt"); expect(api.campaign).toHaveBeenCalledTimes(2); expect(session.snapshot().campaign?.status).toBe("RUNNING");
  });
  it("a failed status read disables commands until refreshed", async () => {
    const { api, session } = fixture(); api.campaign.mockRejectedValueOnce(new ApiNetworkError()); await session.loadCampaign("campaign"); await session.act("resume"); expect(api.resume).not.toHaveBeenCalled(); await session.check(); expect(session.snapshot().phase).toBe("live");
  });
  it("guards double confirmation and disposal", async () => {
    const { api, session } = fixture(); await session.start(input); await Promise.all([session.confirm(), session.confirm()]); expect(api.confirm).toHaveBeenCalledTimes(1); session.dispose(); await session.act("halt"); expect(api.halt).not.toHaveBeenCalled();
  });
});
