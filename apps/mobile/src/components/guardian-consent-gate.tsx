import { useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { LEGAL_URLS } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { giveGuardianConsent, myGuardianConsent } from "../lib/api/consent";
import { useSession } from "../lib/auth/session";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { Body, Button, Heading, Notice } from "./ui";

// Parents whose agreement to the privacy policy and terms was not recorded,
// or was to an older wording, are asked once (docs/modules/data-protection.md).
// A failed read shows nothing: this must never lock a parent out.

export function GuardianConsentGate() {
  const { status, principal, guardian } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [ticked, setTicked] = useState(false);
  // The guardian profile is held in memory only, so after a restart it can be
  // null while the session is live; the token alone answers this read.
  const enabled = status === "authenticated" && principal === "guardian";
  const key = queryKeys.guardianConsent(guardian?.id ?? "current");
  const consent = useQuery({ queryKey: key, queryFn: myGuardianConsent, enabled, staleTime: 60 * 60 * 1000 });
  const agree = useMutation({
    mutationFn: giveGuardianConsent,
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  const visible = enabled && consent.data !== undefined && !consent.data.current;
  if (!visible) return null;

  const open = (url: string) => void Linking.openURL(url);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => undefined}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Heading>Before you continue</Heading>
          <Body muted>
            Your school uses SchoolKit to share your child&apos;s results, fees and news with you. SchoolKit keeps this
            information safe for the school, never sells it, and never uses it for advertising.
          </Body>
          <View style={styles.links}>
            <Pressable accessibilityRole="link" onPress={() => open(LEGAL_URLS.privacy)}>
              <Text style={[styles.link, { color: colors.primary }]}>Read the Privacy Policy</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => open(LEGAL_URLS.terms)}>
              <Text style={[styles.link, { color: colors.primary }]}>Read the Terms of Service</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ticked }}
            onPress={() => setTicked((t) => !t)}
            style={styles.tick}
          >
            <Ionicons name={ticked ? "checkbox" : "square-outline"} size={22} color={colors.primary} />
            <Text style={[styles.tickText, { color: colors.foreground }]}>
              I have read the Privacy Policy and I accept the Terms of Service.
            </Text>
          </Pressable>
          {agree.isError ? (
            <Notice tone="danger">{agree.error instanceof ApiError ? agree.error.message : "Not saved. Try again."}</Notice>
          ) : null}
          <Button title="Continue" loading={agree.isPending} disabled={!ticked} onPress={() => agree.mutate()} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xxl, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  links: { gap: spacing.sm },
  link: { fontSize: 15, textDecorationLine: "underline", fontWeight: "600" },
  tick: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  tickText: { flex: 1, fontSize: 15 },
});
