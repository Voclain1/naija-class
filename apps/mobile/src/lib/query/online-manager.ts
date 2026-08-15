import NetInfo from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";

// Teach TanStack Query what "online" means on a phone.
//
// Without this, onlineManager falls back to a browser-shaped check that has no
// meaning in React Native, and the library assumes it is permanently online —
// which would make refetchOnReconnect never fire and offline states never
// render.

/**
 * `isInternetReachable` vs `isConnected`:
 *
 * `isConnected` only says a network interface is up. On a Nigerian mobile
 * network that is true constantly — attached to a cell with no usable data
 * session, connected to a hotel or campus WiFi captive portal that intercepts
 * every request. `isInternetReachable` is the platform's actual reachability
 * probe and is the honest signal.
 *
 * It is nullable (null = not yet determined). We treat null as ONLINE rather
 * than offline: at cold start the probe has not run, and starting in a
 * believed-offline state would delay the first fetch on a perfectly good
 * connection. Being briefly wrong in the optimistic direction costs one failed
 * request; being wrong pessimistically costs a visibly broken launch.
 */
export function installOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isInternetReachable ?? true);
    }),
  );
}
