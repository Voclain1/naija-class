import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Friendly card shown when the invitation cannot be accepted. Three flavours,
// driven by the API error code on the public GET:
//   - INVITATION_EXPIRED                 → 410: link timed out
//   - INVITATION_ALREADY_ACCEPTED        → 410: already used
//   - NOT_FOUND (or anything else)       → 404: link is wrong
//
// "Go to sign in" CTA because if the user has already been provisioned
// (the already-accepted case especially) they likely just need to log in.
interface Props {
  variant: "expired" | "accepted" | "notFound";
}

const COPY = {
  expired: {
    title: "This invitation has expired",
    body: "Invitations are valid for 7 days. Ask the person who invited you to send a new one.",
  },
  accepted: {
    title: "This invitation has already been used",
    body: "If you've already set up your account, sign in below. If you didn't accept this invitation, please contact your school administrator.",
  },
  notFound: {
    title: "Invitation not found",
    body: "We couldn't find an invitation for this link. Check the URL or ask whoever invited you to send a fresh one.",
  },
} as const;

export function InvitationErrorCard({ variant }: Props) {
  const { title, body } = COPY[variant];
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
