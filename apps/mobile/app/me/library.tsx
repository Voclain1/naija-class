import { useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { StudentLibraryResourceDto } from "@school-kit/types";

import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../src/components/layout";
import { LibraryLoanRows } from "../../src/components/library-card";
import { LoadError } from "../../src/components/load-error";
import { Card, Notice, Screen } from "../../src/components/ui";
import { ApiError } from "../../src/lib/api/client";
import { studentLibrary, studentLibraryResourceFile, studentLibraryResources } from "../../src/lib/api/student-portal";
import { useSession } from "../../src/lib/auth/session";
import { queryKeys } from "../../src/lib/query/keys";
import { spacing } from "../../src/theme/tokens";

// Phase 9 / CP6.2 — the student's own library books out and when each is due
// (docs/modules/phase-9.md §14 CP6-D6). Whether a book is overdue is the
// server's judgement against the school's day, never the phone's clock.
//
// CP6.3 (CP6-D7) — and the PDFs and links the school has put up for the
// student's class. A PDF opens through a five-minute link the server signs
// after checking the class again; a link opens in the browser.
export default function MyLibraryScreen() {
  const { status, principal } = useSession();
  const enabled = status === "authenticated" && principal === "student";
  const query = useQuery({ queryKey: queryKeys.myLibrary, queryFn: () => studentLibrary(), enabled });
  const resources = useQuery({ queryKey: queryKeys.myLibraryResources, queryFn: () => studentLibraryResources(), enabled });
  const [openError, setOpenError] = useState<string | null>(null);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/students" />;

  async function open(r: StudentLibraryResourceDto) {
    setOpenError(null);
    try {
      const url = r.kind === "LINK" ? r.url! : (await studentLibraryResourceFile(r.id)).url;
      await Linking.openURL(url);
    } catch (e) {
      setOpenError(e instanceof ApiError ? e.message : "That could not be opened. Please try again.");
    }
  }

  const loans = query.data?.loans ?? [];
  const items = resources.data?.resources ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching || resources.isRefetching}
            onRefresh={() => {
              void query.refetch();
              void resources.refetch();
            }}
          />
        }
      >
        <ScreenHeader title="My library" subtitle="Books you have out, and reading for your class" />
        <SectionHeader title="Books out" />
        {query.isLoading ? (
          <Skeleton lines={3} />
        ) : query.isError ? (
          <LoadError error={query.error} what="your library books" onRetry={() => void query.refetch()} />
        ) : loans.length === 0 ? (
          <EmptyState icon="library-outline" title="No books out" body="Books you borrow from the school library show here with their due dates." />
        ) : (
          <Card>
            <LibraryLoanRows loans={loans} />
          </Card>
        )}

        <SectionHeader title="Reading for your class" />
        {openError ? <Notice tone="danger">{openError}</Notice> : null}
        {resources.isLoading ? (
          <Skeleton lines={3} />
        ) : resources.isError ? (
          <LoadError error={resources.error} what="your class's reading" onRetry={() => void resources.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="document-text-outline" title="Nothing yet" body="PDFs and links your teachers and the library put up for your class show here." />
        ) : (
          items.map((r) => (
            <ListRow
              key={r.id}
              icon={r.kind === "FILE" ? "document-text-outline" : "link-outline"}
              title={r.title}
              subtitle={[r.subjectName, r.kind === "FILE" ? "PDF" : "Link", r.description].filter(Boolean).join(" · ")}
              onPress={() => void open(r)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
