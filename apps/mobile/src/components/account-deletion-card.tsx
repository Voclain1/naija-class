import { Alert, StyleSheet } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../lib/api/client";
import { myAccountDeletionRequest, requestAccountDeletion } from "../lib/api/account-deletion";
import { useSession } from "../lib/auth/session";
import { queryKeys } from "../lib/query/keys";
import { spacing } from "../theme/tokens";
import { SectionHeader } from "./layout";
import { LegalLinks } from "./legal-links";
import { Body, Button, Caption, Card } from "./ui";

// "Request account deletion" (docs/modules/account-deletion-requests.md), for
// staff, parents and students alike. The app stores require it. It tells the
// school, which holds the records: nothing is deleted from the phone.

export function AccountDeletionCard() {
  const { principal, staff, guardian, student } = useSession();
  const queryClient = useQueryClient();
  const who = staff?.user.id ?? guardian?.id ?? student?.id ?? "";
  const key = queryKeys.accountDeletionRequest(principal ?? "none", who);
  const mine = useQuery({ queryKey: key, queryFn: () => myAccountDeletionRequest(principal!), enabled: principal !== null });
  const ask = useMutation({
    mutationFn: () => requestAccountDeletion(principal!),
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (e) => Alert.alert("Not sent", e instanceof ApiError ? e.message : "Try again in a moment."),
  });

  if (principal === null) return null;
  const requestedAt = mine.data?.requestedAt ?? null;

  const confirm = () =>
    Alert.alert(
      "Ask to delete your account?",
      principal === "student"
        ? "Your school will be told. Your school record stays with the school."
        : "Your school will be told and will remove your account, or contact you if it needs to keep it.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send request", style: "destructive", onPress: () => ask.mutate() },
      ],
    );

  return (
    <Card style={styles.card}>
      <SectionHeader title="Delete my account" />
      {requestedAt ? (
        <Body>
          You asked on {new Date(requestedAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}. Your school has been told.
        </Body>
      ) : (
        <>
          <Caption>
            Your school holds your records, so it removes accounts. This sends your school a request.
          </Caption>
          <Button title="Request account deletion" variant="secondary" loading={ask.isPending} disabled={mine.isLoading} onPress={confirm} />
        </>
      )}
      <LegalLinks />
    </Card>
  );
}

const styles = StyleSheet.create({ card: { gap: spacing.sm } });
