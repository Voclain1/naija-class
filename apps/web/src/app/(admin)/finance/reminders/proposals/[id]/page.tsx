"use client";
import { useParams } from "next/navigation";
import { DurableCampaignPanel } from "@/components/finance/reminders/durable-campaign";
export default function SavedCampaignPage() {
  const { id } = useParams<{ id: string }>();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <p role="alert">Invalid saved workflow link.</p>;
  return <DurableCampaignPanel proposalId={id} />;
}
