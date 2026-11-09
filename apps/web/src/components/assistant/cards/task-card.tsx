"use client";

import type { AssistantCapabilitiesDto } from "@school-kit/types";

import { useAssistant } from "../assistant-provider";
import { CorrectionCard } from "./correction-card";
import { IntakeCard } from "./intake-card";
import { InvoiceCard } from "./invoice-card";
import { ReferenceCard } from "./reference-card";
import { ReminderCard } from "./reminder-card";

export function TaskCard({ taskId, caps }: { taskId: string; caps: AssistantCapabilitiesDto }) {
  const { state } = useAssistant();
  const task = state.tasks[taskId];
  if (!task) return null;
  if (task.reference) return <ReferenceCard task={task} />;
  if (task.status === "closed") return <p className="text-xs text-muted-foreground">Task closed.</p>;
  switch (task.workflow) {
    case "invoices": return <InvoiceCard task={task} caps={caps} />;
    case "reminders": return <ReminderCard task={task} caps={caps} />;
    case "intake": return <IntakeCard task={task} caps={caps} />;
    case "corrections": return <CorrectionCard task={task} caps={caps} />;
  }
}
