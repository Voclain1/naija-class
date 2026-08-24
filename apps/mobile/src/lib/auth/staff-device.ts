import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

const DEVICE_ID_KEY = "sk_staff_device_id";

export async function getStaffDevice(): Promise<{ deviceId: string; deviceName: string }> {
  let deviceId = Platform.OS === "web" ? null : await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    if (Platform.OS !== "web") await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  }
  const rawName = Device.deviceName ?? `${Platform.OS} device`;
  return { deviceId, deviceName: rawName.trim().slice(0, 80) || "Mobile device" };
}
