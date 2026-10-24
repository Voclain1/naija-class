import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ListRow, ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Notice, Screen } from "../../../src/components/ui";
import { WebsiteLink } from "../../../src/components/website-link";
import { ApiError } from "../../../src/lib/api/client";
import { staffWebsite, staffWebsitePosts, staffWebsitePreview } from "../../../src/lib/api/staff-website";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { postStatusLabel, sectionPlanNote } from "../../../src/lib/staff/website";
import { spacing } from "../../../src/theme/tokens";

// The school's public website from the staff app (docs/modules/school-website.md):
// news posts and the photo gallery only. The page details (cover, about us,
// leadership, admissions box) are easier on a computer and stay on the website.
// website.manage, and the owner or admin role, as the API checks both.

export default function WebsiteScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canManage = hasPermission(staff?.permissions ?? [], "website.manage") && isSchoolAdmin(staff?.roles);
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const [opening, setOpening] = useState(false);

  const site = useQuery({ queryKey: queryKeys.staffWebsite(schoolId, userId), queryFn: staffWebsite, enabled: authed && canManage });
  const posts = useQuery({ queryKey: queryKeys.staffWebsitePosts(schoolId, userId), queryFn: staffWebsitePosts, enabled: authed && canManage });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  async function preview(): Promise<void> {
    setOpening(true);
    try {
      const { url } = await staffWebsitePreview();
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      Alert.alert("Couldn't open the preview", e instanceof ApiError ? e.message : "Try again in a moment.");
    } finally {
      setOpening(false);
    }
  }

  const note = site.data ? sectionPlanNote(site.data.sections.find((s) => s.section === "news"), site.data.enforcement) : null;
  const rows = posts.data ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={site.isRefetching || posts.isRefetching} onRefresh={() => void Promise.all([site.refetch(), posts.refetch()])} />
        }
      >
        <ScreenHeader title="School website" subtitle="News and photos" />
        {!canManage ? (
          <Notice tone="info">Your account can&apos;t change the school website.</Notice>
        ) : site.isLoading ? (
          <Skeleton lines={4} />
        ) : site.isError ? (
          <LoadError error={site.error} what="the school website" onRetry={() => void site.refetch()} />
        ) : (
          <>
            <Body muted>News is for anyone visiting the page. It does not reach parents&apos; phones; announcements do that.</Body>
            <View style={styles.actions}>
              <Button title="Write a post" onPress={() => router.push("/staff/website/post/new")} />
              <Button title="Photo gallery" variant="secondary" onPress={() => router.push("/staff/website/gallery")} />
              <Button title="Preview the page" variant="secondary" loading={opening} onPress={() => void preview()} />
            </View>

            <SectionHeader title="News" note={site.data ? `${site.data.counts.publishedPosts} published` : null} />
            {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
            {posts.isLoading ? (
              <Skeleton lines={3} />
            ) : posts.isError ? (
              <LoadError error={posts.error} what="news posts" onRetry={() => void posts.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState icon="newspaper-outline" title="No posts yet" body="Write a post, add photos, then publish it." />
            ) : (
              rows.map((post) => (
                <ListRow
                  key={post.id}
                  icon="newspaper-outline"
                  title={post.title}
                  subtitle={post.photos.length > 0 ? `${post.photos.length} photo${post.photos.length === 1 ? "" : "s"}` : "No photos"}
                  meta={postStatusLabel(post)}
                  onPress={() => router.push({ pathname: "/staff/website/post/[id]", params: { id: post.id } })}
                />
              ))
            )}
          </>
        )}
        {canManage ? <WebsiteLink path="/settings/website" title="Cover, about us and leadership on the website" /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
