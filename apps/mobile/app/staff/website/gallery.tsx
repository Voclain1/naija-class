import { useState } from "react";
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { WEBSITE_LIMITS, type WebsiteAlbumDto, type WebsitePhotoDto } from "@school-kit/types";

import { ChoiceChips, TextField } from "../../../src/components/form";
import { ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../src/components/ui";
import { WebsitePhotoUpload } from "../../../src/components/website-photo-upload";
import { ApiError } from "../../../src/lib/api/client";
import {
  staffCreateWebsiteAlbum,
  staffDeleteWebsiteAlbum,
  staffDeleteWebsitePhoto,
  staffRenameWebsiteAlbum,
  staffUpdateWebsitePhoto,
  staffWebsite,
  staffWebsitePhotos,
} from "../../../src/lib/api/staff-website";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { isSchoolAdmin } from "../../../src/lib/auth/roles";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { galleryCap, galleryCountLine, groupByAlbum, sectionPlanNote } from "../../../src/lib/staff/website";
import { useTheme } from "../../../src/theme/theme-provider";
import { radii, spacing } from "../../../src/theme/tokens";

// The website's photo gallery (docs/modules/school-website.md): photos with
// optional captions, in optional albums. No pupils (W4): every upload asks.

const NO_ALBUM = "none";

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function WebsiteGalleryScreen() {
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canManage = hasPermission(staff?.permissions ?? [], "website.manage") && isSchoolAdmin(staff?.roles);
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const siteKey = queryKeys.staffWebsite(schoolId, userId);
  const galleryKey = queryKeys.staffWebsiteGallery(schoolId, userId);

  const site = useQuery({ queryKey: siteKey, queryFn: staffWebsite, enabled: authed && canManage });
  const gallery = useQuery({ queryKey: galleryKey, queryFn: () => staffWebsitePhotos("GALLERY"), enabled: authed && canManage });

  const [uploadAlbum, setUploadAlbum] = useState<string>(NO_ALBUM);
  const [newAlbum, setNewAlbum] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [selected, setSelected] = useState<{ id: string; caption: string; albumId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: galleryKey });
      void queryClient.invalidateQueries({ queryKey: siteKey });
      return true;
    } catch (e) {
      Alert.alert("Not saved", message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const confirmDeleteAlbum = (album: WebsiteAlbumDto) =>
    Alert.alert("Delete this album?", `“${album.title}” will be deleted. Its photos stay in the gallery.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run(() => staffDeleteWebsiteAlbum(album.id)) },
    ]);

  const confirmDeletePhoto = (photo: WebsitePhotoDto) =>
    Alert.alert("Delete this photo?", "It comes off the website and is deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await staffDeleteWebsitePhoto(photo.id);
            setSelected(null);
          }),
      },
    ]);

  const photos = gallery.data?.photos ?? [];
  const albums = gallery.data?.albums ?? [];
  const cap = site.data ? galleryCap(site.data) : WEBSITE_LIMITS.galleryPhotos;
  const note = site.data ? sectionPlanNote(site.data.sections.find((s) => s.section === "gallery"), site.data.enforcement) : null;
  const albumChoices = [{ value: NO_ALBUM, label: "No album" }, ...albums.map((a) => ({ value: a.id, label: a.title }))];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={gallery.isRefetching} onRefresh={() => void gallery.refetch()} />}
      >
        <ScreenHeader title="Photo gallery" subtitle="On the school website" />
        {!canManage ? (
          <Notice tone="info">Your account can&apos;t change the school website.</Notice>
        ) : gallery.isLoading ? (
          <Skeleton lines={4} />
        ) : gallery.isError ? (
          <LoadError error={gallery.error} what="the gallery" onRetry={() => void gallery.refetch()} />
        ) : (
          <>
            {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
            <Body muted>{galleryCountLine(photos, cap)}.</Body>

            <SectionHeader title="Add a photo" />
            {photos.length >= cap ? (
              <Notice tone="warning">The gallery is full on your plan. Delete a photo to add another.</Notice>
            ) : (
              <>
                {albums.length > 0 ? (
                  <ChoiceChips label="Album" options={albumChoices} value={uploadAlbum} onChange={setUploadAlbum} />
                ) : null}
                <WebsitePhotoUpload
                  kind="GALLERY"
                  albumId={uploadAlbum === NO_ALBUM ? undefined : uploadAlbum}
                  withCaption
                  disabled={busy}
                  onUploaded={() => {
                    void queryClient.invalidateQueries({ queryKey: galleryKey });
                    void queryClient.invalidateQueries({ queryKey: siteKey });
                  }}
                />
              </>
            )}

            <SectionHeader title="Albums" note={`${albums.length} of ${WEBSITE_LIMITS.albums}`} />
            {albums.map((a) =>
              renaming?.id === a.id ? (
                <Card key={a.id} style={styles.form}>
                  <TextField label="Album name" value={renaming.title} onChangeText={(t) => setRenaming({ id: a.id, title: t })} maxLength={WEBSITE_LIMITS.albumTitle} />
                  <View style={styles.row}>
                    <Button
                      title="Save"
                      loading={busy}
                      disabled={!renaming.title.trim()}
                      onPress={() => void run(() => staffRenameWebsiteAlbum(a.id, renaming.title).then(() => setRenaming(null)))}
                    />
                    <Button title="Cancel" variant="secondary" onPress={() => setRenaming(null)} />
                  </View>
                </Card>
              ) : (
                <Card key={a.id} style={styles.albumRow}>
                  <View style={styles.grow}>
                    <Body>{a.title}</Body>
                    <Caption>
                      {a.photoCount} photo{a.photoCount === 1 ? "" : "s"}
                    </Caption>
                  </View>
                  <Button title="Rename" variant="secondary" onPress={() => setRenaming({ id: a.id, title: a.title })} />
                  <Button title="Delete" variant="secondary" disabled={busy} onPress={() => confirmDeleteAlbum(a)} />
                </Card>
              ),
            )}
            {albums.length < WEBSITE_LIMITS.albums ? (
              <Card style={styles.form}>
                <TextField label="New album" value={newAlbum} onChangeText={setNewAlbum} maxLength={WEBSITE_LIMITS.albumTitle} placeholder="e.g. Sports day 2026" />
                <Button
                  title="Add the album"
                  variant="secondary"
                  loading={busy}
                  disabled={!newAlbum.trim()}
                  onPress={() => void run(() => staffCreateWebsiteAlbum(newAlbum).then(() => setNewAlbum("")))}
                />
              </Card>
            ) : null}

            {photos.length === 0 ? (
              <Caption>No photos yet.</Caption>
            ) : (
              groupByAlbum(photos, albums).map((group) => (
                <View key={group.albumId ?? NO_ALBUM} style={styles.group}>
                  <SectionHeader title={group.title} note={`${group.photos.length}`} />
                  <View style={styles.photos}>
                    {group.photos.map((p) => (
                      <Pressable
                        key={p.id}
                        accessibilityRole="button"
                        accessibilityLabel={p.caption ? `Photo: ${p.caption}` : "Photo"}
                        onPress={() => setSelected({ id: p.id, caption: p.caption ?? "", albumId: p.albumId ?? NO_ALBUM })}
                        style={styles.photo}
                      >
                        <Image
                          source={{ uri: p.thumbUrl }}
                          style={[styles.thumb, p.takenDown ? styles.faded : null, selected?.id === p.id ? { borderColor: colors.primary, borderWidth: 2 } : null]}
                        />
                        {p.takenDown ? <Caption>Taken down: {p.takenDown.reason}</Caption> : p.caption ? <Caption>{p.caption}</Caption> : null}
                      </Pressable>
                    ))}
                  </View>
                  {group.photos.some((p) => p.id === selected?.id) && selected ? (
                    <PhotoEditor
                      photo={group.photos.find((p) => p.id === selected.id)!}
                      value={selected}
                      albums={albumChoices}
                      busy={busy}
                      onChange={setSelected}
                      onSave={() =>
                        void run(async () => {
                          await staffUpdateWebsitePhoto(selected.id, {
                            caption: selected.caption.trim() || null,
                            albumId: selected.albumId === NO_ALBUM ? null : selected.albumId,
                          });
                          setSelected(null);
                        })
                      }
                      onDelete={(photo) => confirmDeletePhoto(photo)}
                      onClose={() => setSelected(null)}
                    />
                  ) : null}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function PhotoEditor({
  photo,
  value,
  albums,
  busy,
  onChange,
  onSave,
  onDelete,
  onClose,
}: {
  photo: WebsitePhotoDto;
  value: { id: string; caption: string; albumId: string };
  albums: { value: string; label: string }[];
  busy: boolean;
  onChange: (next: { id: string; caption: string; albumId: string }) => void;
  onSave: () => void;
  onDelete: (photo: WebsitePhotoDto) => void;
  onClose: () => void;
}) {
  if (photo.takenDown) {
    return (
      <Card style={styles.form}>
        <Caption>SchoolKit took this photo down: {photo.takenDown.reason}. It cannot go back up.</Caption>
        <View style={styles.row}>
          <Button title="Delete" variant="secondary" disabled={busy} onPress={() => onDelete(photo)} />
          <Button title="Close" variant="secondary" onPress={onClose} />
        </View>
      </Card>
    );
  }
  return (
    <Card style={styles.form}>
      <TextField label="Caption (optional)" value={value.caption} onChangeText={(caption) => onChange({ ...value, caption })} maxLength={WEBSITE_LIMITS.caption} />
      {albums.length > 1 ? (
        <ChoiceChips label="Album" options={albums} value={value.albumId} onChange={(albumId) => onChange({ ...value, albumId })} />
      ) : null}
      <View style={styles.row}>
        <Button title="Save" loading={busy} onPress={onSave} />
        <Button title="Delete" variant="secondary" disabled={busy} onPress={() => onDelete(photo)} />
        <Button title="Close" variant="secondary" onPress={onClose} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  form: { gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  albumRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  grow: { flex: 1, minWidth: 120 },
  group: { gap: spacing.sm },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photo: { width: 104, gap: spacing.xs },
  thumb: { width: 104, height: 78, borderRadius: radii.sm },
  faded: { opacity: 0.4 },
});
