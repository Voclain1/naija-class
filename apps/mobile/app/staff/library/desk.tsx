import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatKobo, type LibraryBorrowerDto, type LibraryBorrowerKind, type LibraryCopyLookupDto } from "@school-kit/types";

import { ChoiceChips, TextField } from "../../../src/components/form";
import { ListRow, ScreenHeader } from "../../../src/components/layout";
import { formatLibraryDay } from "../../../src/components/library-card";
import { Body, Button, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { ApiError } from "../../../src/lib/api/client";
import {
  staffLibraryBorrowers,
  staffLibraryCopy,
  staffLibraryIssue,
  staffLibraryLost,
  staffLibraryRenew,
  staffLibraryReturn,
} from "../../../src/lib/api/staff-library";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP6.2 — the lending desk on the staff app (docs/modules/phase-9.md
// §14 CP6-D2/D3/D4), as on the website: type a copy's number, then lend it,
// take it back, renew it, or mark it lost. A late student's fine and a lost
// book's replacement price are the API's figures, shown before confirming and
// waivable with a reason. Due dates are the school's loan period.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

function chargedText(charged: number, waived: string | null, what: string): string {
  if (charged > 0) return ` ${formatKobo(charged)} added to the family's fees.`;
  return waived ? ` The ${what} was waived.` : "";
}

const KINDS = [
  { value: "STUDENT" as const, label: "A student" },
  { value: "STAFF" as const, label: "Staff" },
];

export default function LendingDeskScreen() {
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canLend = hasPermission(staff?.permissions ?? [], "library.lend");
  const [number, setNumber] = useState("");
  const [found, setFound] = useState<LibraryCopyLookupDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  async function look() {
    if (!number.trim()) return setError("Type the accession number.");
    setError(null);
    setNotice(null);
    setFound(null);
    try {
      setFound(await staffLibraryCopy(number.trim()));
    } catch (e) {
      setError(message(e));
    }
  }

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setNotice(await fn());
      setFound(null);
      setNumber("");
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Lending desk" subtitle="Lend, take back or renew a book" />
        {!canLend ? (
          <Notice tone="info">Your account can&apos;t lend library books.</Notice>
        ) : (
          <>
            <TextField label="Accession number" value={number} onChangeText={setNumber} />
            <Button title="Find copy" onPress={() => void look()} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            {found ? <CopyPanel found={found} busy={busy} act={act} /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function CopyPanel({ found, busy, act }: { found: LibraryCopyLookupDto; busy: boolean; act: (fn: () => Promise<string>) => Promise<void> }) {
  const loan = found.loan;
  const [mode, setMode] = useState<"return" | "lost">("return");
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const fine = loan?.fineSoFar ?? 0;
  const price = loan?.borrower.kind === "STUDENT" ? (found.book.replacementPrice ?? 0) : 0;
  const owed = mode === "return" ? fine : price;

  function waiveReason(): string | undefined | false {
    if (!waive || owed === 0) return undefined;
    if (reason.trim().length < 3) {
      setLocalError("Say why it is waived.");
      return false;
    }
    return reason.trim();
  }

  return (
    <Card>
      <Label>No. {found.copy.accessionNumber}</Label>
      <Body>{found.book.title}</Body>
      {found.book.authors ? <Body muted>{found.book.authors}</Body> : null}

      {loan ? (
        <View style={styles.block}>
          <Body>
            Lent to {loan.borrower.name} ({loan.borrower.detail}).{" "}
            {loan.overdue
              ? `Overdue by ${loan.daysLate} ${loan.daysLate === 1 ? "day" : "days"} (due ${formatLibraryDay(loan.dueOn)}).`
              : `Due ${formatLibraryDay(loan.dueOn)}.`}
          </Body>
          {mode === "return" && fine > 0 ? <Notice tone="warning">Fine if returned today: {formatKobo(fine)}.</Notice> : null}
          {mode === "lost" ? (
            <Notice tone="warning">
              {loan.borrower.kind !== "STUDENT"
                ? "Staff are not charged for a lost book."
                : price > 0
                  ? `Marking it lost charges the family the replacement price, ${formatKobo(price)}, instead of any fine.`
                  : "This book has no replacement price, so nothing is charged."}
            </Notice>
          ) : null}
          {owed > 0 ? (
            <>
              <Button
                variant="secondary"
                title={waive ? "Don't waive" : mode === "return" ? "Waive the fine" : "Waive the charge"}
                onPress={() => setWaive((w) => !w)}
              />
              {waive ? <TextField label="Reason for waiving" value={reason} onChangeText={setReason} maxLength={300} /> : null}
            </>
          ) : null}
          {localError ? <Notice tone="danger">{localError}</Notice> : null}
          {mode === "return" ? (
            <>
              <Button
                title="Return book"
                loading={busy}
                onPress={() => {
                  const w = waiveReason();
                  if (w === false) return;
                  void act(async () => {
                    const r = await staffLibraryReturn(found.copy.accessionNumber, w);
                    return `"${r.loan.title}" is back from ${r.loan.borrower.name}.${chargedText(r.charged, r.loan.fineWaivedReason, "fine")}`;
                  });
                }}
              />
              {!loan.overdue && loan.renewalsLeft > 0 ? (
                <Button
                  variant="secondary"
                  title="Renew"
                  disabled={busy}
                  onPress={() =>
                    void act(async () => {
                      const l = await staffLibraryRenew(loan.id);
                      return `Renewed. Now due ${formatLibraryDay(l.dueOn)}.`;
                    })
                  }
                />
              ) : null}
              <Button variant="secondary" title="Book lost" disabled={busy} onPress={() => { setMode("lost"); setWaive(false); }} />
            </>
          ) : (
            <>
              <Button
                title="Mark lost"
                loading={busy}
                onPress={() => {
                  const w = waiveReason();
                  if (w === false) return;
                  void act(async () => {
                    const r = await staffLibraryLost(loan.id, w);
                    return `"${r.loan.title}" is marked lost.${chargedText(r.charged, r.loan.fineWaivedReason, "replacement price")}`;
                  });
                }}
              />
              <Button variant="secondary" title="Cancel" disabled={busy} onPress={() => { setMode("return"); setWaive(false); }} />
            </>
          )}
        </View>
      ) : found.book.referenceOnly ? (
        <Body muted>This book is for reference only and stays in the library.</Body>
      ) : found.copy.status !== "AVAILABLE" ? (
        <Body muted>This copy is not on the shelf, so it cannot be lent.</Body>
      ) : (
        <LendPanel accessionNumber={found.copy.accessionNumber} busy={busy} act={act} />
      )}
    </Card>
  );
}

function LendPanel({ accessionNumber, busy, act }: { accessionNumber: string; busy: boolean; act: (fn: () => Promise<string>) => Promise<void> }) {
  const [kind, setKind] = useState<LibraryBorrowerKind>("STUDENT");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<LibraryBorrowerDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    if (!search.trim()) return setError(kind === "STUDENT" ? "Type a name or admission number." : "Type a name.");
    setError(null);
    try {
      setResults(await staffLibraryBorrowers(kind, search.trim()));
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <View style={styles.block}>
      <ChoiceChips
        label="Lend to"
        options={KINDS}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setResults(null);
        }}
      />
      <TextField label={kind === "STUDENT" ? "Find a student" : "Find a member of staff"} value={search} onChangeText={setSearch} />
      <Button variant="secondary" title="Find" onPress={() => void find()} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {results?.length === 0 ? <Body muted>Nobody found.</Body> : null}
      {(results ?? []).map((r) => (
        <ListRow
          key={r.id}
          icon="person-outline"
          title={r.name}
          subtitle={`${r.detail} · ${r.booksOut} of ${r.limit} books out`}
          {...(busy || r.booksOut >= r.limit
            ? { meta: r.booksOut >= r.limit ? "At the limit" : null }
            : {
                meta: "Lend",
                onPress: () =>
                  void act(async () => {
                    const loan = await staffLibraryIssue({ accessionNumber, ...(r.kind === "STUDENT" ? { studentId: r.id } : { userId: r.id }) });
                    return `"${loan.title}" lent to ${loan.borrower.name}. Due ${formatLibraryDay(loan.dueOn)}.`;
                  }),
              })}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  block: { gap: spacing.sm, marginTop: spacing.sm },
});
