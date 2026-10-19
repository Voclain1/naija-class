import { useQuery } from "@tanstack/react-query";

import { staffMyIdCard } from "../lib/api/staff-photo";
import { IdCardView } from "./id-card-view";
import { SectionHeader } from "./layout";
import { Caption, Card } from "./ui";

// The staff member's own ID card, on the profile screen (2026-10-19).
export function OwnIdCard({ schoolId, userId }: { schoolId: string; userId: string }) {
  const query = useQuery({
    queryKey: ["staff", schoolId, userId, "id-card"] as const,
    queryFn: staffMyIdCard,
    staleTime: 10 * 60_000,
  });
  const data = query.data;
  if (!data) return null;
  return (
    <Card>
      <SectionHeader title="My ID card" />
      {data.card ? (
        <IdCardView data={{ ...data, card: data.card }} />
      ) : (
        <Caption>Your school has not issued you an ID card for this session.</Caption>
      )}
    </Card>
  );
}
