import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";

export async function canProtectStaffSession(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  return LocalAuthentication.isEnrolledAsync();
}

export async function unlockStaffSession(): Promise<boolean> {
  if (!(await canProtectStaffSession())) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock SchoolKit staff access",
    cancelLabel: "Sign out",
    disableDeviceFallback: false,
  });
  return result.success;
}
