import { useEffect, useState } from "react";
import { Alert, Image, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { WEBSITE_LIMITS, type WebsitePostDto } from "@school-kit/types";

import { TextField } from "../../../../src/components/form";
import { ScreenHeader, SectionHeader, Skeleton } from "../../../../src/components/layout";
import { LoadError } from "../../../../src/components/load-error";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../../src/components/ui";
import { WebsitePhotoUpload } from "../../../../src/components/website-photo-upload";
import { ApiError } from "../../../../src/lib/api/client";
import {
  staffCreateWebsitePost,
  staffDeleteWebsitePhoto,
  staffDeleteWebsitePost,
  staffSetWebsitePostPublished,
  staffUpdateWebsitePost,
  staffWebsite,
  staffWebsitePosts,
} from "../../../../src/lib/api/staff-website";
import { hasPermission } from "../../../../src/lib/auth/permissions";
import { isSchoolAdmin } from "../../../../src/lib/auth/roles";
import { useSession } from "../../../../src/lib/auth/session";
import { queryKeys } from "../../../../src/lib/query/keys";
import { canChangePost, photosPerPost, postFormReady, postStatusLabel } from "../../../../src/lib/staff/website";
import { useTheme } from "../../../../src/theme/theme-provider";
import { radii, spacing } from "../../../../src/theme/tokens";

// One news post (docs/modules/school-website.md): write it, add photos, then
// publish. "new" writes a draft first, because photos belong to a saved post.
// A post SchoolKit took down is read-only, with the reason, as on the web.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function WebsitePostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canManage = hasPermission(staff?.permissions ?? [], "website.manage") && isSchoolAdmin(staff?.roles);
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const postsKey = queryKeys.staffWebsitePosts(schoolId, userId);
  const siteKey = queryKeys.staffWebsite(schoolId, userId);

  const site = useQuery({ queryKey: siteKey, queryFn: staffWebsite, enabled: authed && canManage });
  const posts = useQuery({ queryKey: postsKey, queryFn: staffWebsitePosts, enabled: authed && canManage && !isNew });
  const post = isNew ? null : (posts.data?.find((p) => p.id === id) ?? null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(isNew);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (post && !editing) {
      setTitle(post.title);
      setBody(post.body);
    }
  }, [post, editing]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  /** Puts the server's copy of the post in the list, so every screen shows it at once. */
  function store(next: WebsitePostDto): void {
    queryClient.setQueryData<WebsitePostDto[]>(postsKey, (prev) => {
      const list = prev ?? [];
      return list.some((p) => p.id === next.id) ? list.map((p) => (p.id === next.id ? next : p)) : [next, ...list];
    });
    void queryClient.invalidateQueries({ queryKey: siteKey });
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert("Not saved", message(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      if (isNew) {
        const created = await staffCreateWebsitePost({ title, body });
        store(created);
        router.replace({ pathname: "/staff/website/post/[id]", params: { id: created.id } });
        Alert.alert("Draft saved", "Add photos, then publish it.");
      } else if (post) {
        store(await staffUpdateWebsitePost(post.id, { title, body }));
        setEditing(false);
      }
    });

  const confirmDelete = (target: WebsitePostDto) =>
    Alert.alert("Delete this post?", `“${target.title}” and its photos will be deleted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await staffDeleteWebsitePost(target.id);
            queryClient.setQueryData<WebsitePostDto[]>(postsKey, (prev) => (prev ?? []).filter((p) => p.id !== target.id));
            void queryClient.invalidateQueries({ queryKey: siteKey });
            router.back();
          }),
      },
    ]);

  const form = (
    <Card style={styles.form}>
      <TextField label="Title" value={title} onChangeText={setTitle} maxLength={WEBSITE_LIMITS.postTitle} placeholder="e.g. Our new science laboratory" />
      <TextField label="Post" value={body} onChangeText={setBody} multiline maxLength={WEBSITE_LIMITS.postBody} />
      <Caption>
        {body.length} of {WEBSITE_LIMITS.postBody} characters. Never name a pupil in a post. This page is public.
      </Caption>
      <View style={styles.row}>
        <Button title={isNew ? "Save as draft" : "Save"} loading={busy} disabled={!postFormReady(title, body)} onPress={() => void save()} />
        {!isNew ? <Button title="Cancel" variant="secondary" disabled={busy} onPress={() => setEditing(false)} /> : null}
      </View>
    </Card>
  );

  let content;
  if (!canManage) {
    content = <Notice tone="info">Your account can&apos;t change the school website.</Notice>;
  } else if (isNew) {
    content = form;
  } else if (posts.isLoading) {
    content = <Skeleton lines={4} />;
  } else if (posts.isError) {
    content = <LoadError error={posts.error} what="the post" onRetry={() => void posts.refetch()} />;
  } else if (!post) {
    content = <Notice tone="info">This post was deleted.</Notice>;
  } else {
    const changeable = canChangePost(post);
    const maxPhotos = site.data ? photosPerPost(site.data) : WEBSITE_LIMITS.photosPerPost;
    content = (
      <>
        <Card style={[styles.status, post.takenDown ? { backgroundColor: colors.tileGold } : null]}>
          <Body>{postStatusLabel(post)}</Body>
          {post.takenDown ? (
            <Caption>SchoolKit took this post down: {post.takenDown.reason}. It cannot go back up.</Caption>
          ) : post.status === "PUBLISHED" ? (
            <Caption>Anyone visiting the school&apos;s page can read it.</Caption>
          ) : (
            <Caption>Only staff can see a draft. Publish it to put it on the page.</Caption>
          )}
        </Card>

        {editing && changeable ? (
          form
        ) : (
          <Card style={styles.form}>
            <Body>{post.title}</Body>
            <Body muted>{post.body}</Body>
            {changeable ? <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} /> : null}
          </Card>
        )}

        <SectionHeader title="Photos" note={`${post.photos.length} of ${maxPhotos}`} />
        {post.photos.length > 0 ? (
          <View style={styles.photos}>
            {post.photos.map((p) => (
              <View key={p.id} style={styles.photo}>
                <Image source={{ uri: p.thumbUrl }} accessibilityLabel={p.caption ?? "News photo"} style={[styles.thumb, p.takenDown ? styles.faded : null]} />
                {p.takenDown ? <Caption>Taken down</Caption> : null}
                {changeable ? (
                  <Button
                    title="Remove"
                    variant="secondary"
                    disabled={busy}
                    onPress={() =>
                      void run(async () => {
                        await staffDeleteWebsitePhoto(p.id);
                        store({ ...post, photos: post.photos.filter((x) => x.id !== p.id) });
                      })
                    }
                  />
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <Caption>No photos on this post.</Caption>
        )}
        {changeable && post.photos.length < maxPhotos ? (
          <WebsitePhotoUpload kind="POST" postId={post.id} disabled={busy} onUploaded={(p) => store({ ...post, photos: [...post.photos, p] })} />
        ) : null}

        {changeable ? (
          <View style={styles.row}>
            {post.status === "PUBLISHED" ? (
              <Button title="Take off the website" variant="secondary" loading={busy} onPress={() => void run(async () => store(await staffSetWebsitePostPublished(post.id, false)))} />
            ) : (
              <Button title="Publish" loading={busy} onPress={() => void run(async () => store(await staffSetWebsitePostPublished(post.id, true)))} />
            )}
            <Button title="Delete" variant="secondary" disabled={busy} onPress={() => confirmDelete(post)} />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader title={isNew ? "Write a post" : "News post"} subtitle="On the school website" />
        {content}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  form: { gap: spacing.sm },
  status: { gap: spacing.xs },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photo: { gap: spacing.xs, width: 140 },
  thumb: { width: 140, height: 105, borderRadius: radii.sm },
  faded: { opacity: 0.4 },
});
