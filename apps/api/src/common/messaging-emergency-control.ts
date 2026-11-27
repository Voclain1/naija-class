import { basePrisma } from "@school-kit/db";
import type { MessagingEmergencyChannel, MessagingEmergencyState, MessagingEmergencyWrite } from "@school-kit/types";

export async function messagingEmergencyState(channel: MessagingEmergencyChannel): Promise<MessagingEmergencyState> {
  const entry = await basePrisma.messagingEmergencyControl.findFirst({
    where: { channel }, select: { stopped: true, revision: true }, orderBy: { revision: "desc" },
  });
  return { stopped: entry?.stopped ?? false, revision: entry?.revision.toString() ?? null };
}

export async function writeMessagingEmergencyState(
  channel: MessagingEmergencyChannel, actorId: string, input: MessagingEmergencyWrite,
): Promise<MessagingEmergencyState> {
  const entry = await basePrisma.messagingEmergencyControl.create({
    data: { channel, actorId, ...input }, select: { stopped: true, revision: true },
  });
  return { stopped: entry.stopped, revision: entry.revision.toString() };
}
