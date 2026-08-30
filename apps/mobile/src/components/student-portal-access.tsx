import { useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deactivateStudentPortal,
  getPortalStatus,
  issueStudentInvitation,
} from "../lib/api/portal";
import { queryKeys } from "../lib/query/keys";
import { ApiNetworkError } from "../lib/api/client";
import { useSession } from "../lib/auth/session";
import { spacing } from "../theme/tokens";
import { Body, Button, Card, Heading, Label, Notice } from "./ui";

// D26 — the guardian's control over their child's portal access.
//
// The parent, not the school, decides whether their child gets an account.
// Three things they can do here: see the current state, issue a single-use
// invitation, and switch access off again.
//
// WHY THE CODE IS SHOWN RATHER THAN EMAILED: the server returns the raw token
// to the caller and sends nothing itself. Handing it to the parent to pass on
// is deliberate — the child may have no email address of their own, which is
// the normal case for a Nigerian primary or junior secondary pupil.

interface Props {
  studentId: string;
  studentFirstName: string | null;
}

export function StudentPortalAccess({ studentId, studentFirstName }: Props) {
  const queryClient = useQueryClient();
  // Read from the signed-in guardian's own session rather than fetched: a
  // parent is always in exactly one school here, and it is already loaded.
  const { school } = useSession();
  const schoolSlug = school?.slug ?? null;
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: queryKeys.portalStatus(studentId),
    queryFn: () => getPortalStatus(studentId),
    enabled: studentId.length > 0,
  });

  function describeFailure(caught: unknown): string {
    if (caught instanceof ApiNetworkError) {
      return "Can't reach SchoolKit. Check your connection and try again.";
    }
    return caught instanceof Error ? caught.message : "Something went wrong.";
  }

  const invite = useMutation({
    mutationFn: () => issueStudentInvitation(studentId),
    onSuccess: async (response) => {
      setError(null);
      // Held in component state only, never in the query cache: the query
      // cache is persisted to disk, and a single-use credential does not
      // belong in a file that outlives the screen (D12).
      setIssuedToken(response.token);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.portalStatus(studentId),
      });
    },
    onError: (caught) => setError(describeFailure(caught)),
  });

  const deactivate = useMutation({
    mutationFn: () => deactivateStudentPortal(studentId),
    onSuccess: async () => {
      setError(null);
      // Any code on screen is dead the moment access is switched off — the
      // server revokes outstanding invitations as part of the same call.
      setIssuedToken(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.portalStatus(studentId),
      });
    },
    onError: (caught) => setError(describeFailure(caught)),
  });

  const status = statusQuery.data;
  const busy = invite.isPending || deactivate.isPending;
  const name = studentFirstName ?? "your child";

  return (
    <Card>
      <Heading>Student sign-in</Heading>

      {statusQuery.isLoading && <Body muted>Loading…</Body>}

      {statusQuery.isError && !status && (
        <Body muted>We couldn&apos;t check this just now.</Body>
      )}

      {status && (
        <>
          {status.state === "ACTIVE" ? (
            <Body>
              {name} can sign in to SchoolKit and see their own results.
            </Body>
          ) : status.state === "DEACTIVATED" ? (
            <Body>
              {name}&apos;s access is switched off. Send a new invitation to
              turn it back on.
            </Body>
          ) : (
            <Body>
              {name} doesn&apos;t have an account yet. Send an invitation and
              they&apos;ll choose their own password.
            </Body>
          )}

          {/* A pending invitation is worth surfacing on its own: without it a
              parent who already sent one has no way to tell, and would keep
              issuing new codes that silently revoke the previous one. */}
          {status.hasPendingInvitation && !issuedToken ? (
            <Notice>
              An invitation is already waiting to be used. Sending a new one
              will replace it.
            </Notice>
          ) : null}

          {issuedToken ? (
            <View style={styles.tokenBlock}>
              <Label>Invitation code</Label>
              {/* selectable so a parent on a device can long-press to copy —
                  there is no clipboard dependency in this app. */}
              <Body>{issuedToken}</Body>
              {/* The school code is shown beside the invitation, not instead
                  of it. The invitation alone gets the child in the first
                  time; the school code is what they need for every sign-in
                  AFTER that, and this is the one moment a parent is already
                  passing sign-in details on. Without it here, activation
                  succeeds and the second login quietly cannot happen. */}
              {schoolSlug ? (
                <>
                  <Label>School code</Label>
                  <Body>{schoolSlug}</Body>
                </>
              ) : null}
              <Body muted>
                Send this to {name}. On the sign-in screen they choose
                &quot;Student&quot;, then &quot;First time? Use your
                invitation&quot;.
              </Body>
              <Button
                title="Share code"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  void Share.share({
                    // The school code rides along in the shared text for the
                    // same reason it is on screen: the message a parent sends
                    // is usually the only written record the child keeps.
                    message: schoolSlug
                      ? `Your SchoolKit invitation code: ${issuedToken}\nSchool code (for signing in later): ${schoolSlug}`
                      : `Your SchoolKit invitation code: ${issuedToken}`,
                  }).catch(() => {
                    // Share is unavailable on some targets (including web).
                    // The code is on screen regardless, so this is not worth
                    // an error message.
                  });
                }}
              />
            </View>
          ) : null}

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Button
            title={
              status.state === "NEVER_ACTIVATED"
                ? "Send invitation"
                : "Send a new invitation"
            }
            loading={invite.isPending}
            disabled={busy}
            onPress={() => invite.mutate()}
          />

          {status.state === "ACTIVE" ? (
            <Button
              title="Switch off access"
              variant="secondary"
              loading={deactivate.isPending}
              disabled={busy}
              onPress={() => deactivate.mutate()}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  tokenBlock: { gap: spacing.xs, marginTop: spacing.xs },
});
