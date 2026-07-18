// Typed wrappers around /notification-preferences. Shapes come from
// @school-kit/types so the client can't drift from the API.

import type {
  NotificationPreferenceDto,
  UpdateNotificationPreferencesInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getNotificationPreferences(): Promise<NotificationPreferenceDto> {
  return apiFetch<NotificationPreferenceDto>("/notification-preferences", {
    method: "GET",
  });
}

export function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferenceDto> {
  return apiFetch<NotificationPreferenceDto>("/notification-preferences", {
    method: "PUT",
    body: input,
  });
}
