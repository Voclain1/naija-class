import { Image, Linking, Pressable, StyleSheet, View } from "react-native";

import type { MessageDto } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { Body, Caption } from "./ui";

// Phase 9 / CP8.1 — one conversation's messages (docs/modules/phase-9.md
// §17.8), for the parent app and the staff app. Your own messages sit on the
// right on a tinted background; theirs on the left on a card. No coloured
// edges (the project's no-accent-borders rule).
//
// CP8.2: photos (tap to open full size; the link lasts 5 minutes), and, for
// the owner and admins, messages with a safeguarding word tinted amber and
// labelled in words.

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function MessageThread({
  messages,
  seenAfterId,
  safeguardingIds = [],
}: {
  messages: (MessageDto & { writtenBy?: string | null })[];
  seenAfterId?: string | null;
  safeguardingIds?: string[];
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.list} accessibilityLabel="Messages">
      {messages.map((m) => {
        const flagged = safeguardingIds.includes(m.id);
        return (
          <View
            key={m.id}
            style={[
              styles.bubble,
              m.mine
                ? { alignSelf: "flex-end", backgroundColor: `${colors.primary}1A` }
                : { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
              flagged ? { backgroundColor: `${colors.warning}33` } : null,
            ]}
          >
            {flagged ? <Caption style={styles.flagWord}>Safeguarding word</Caption> : null}
            <Caption>
              {m.author} · {when(m.sentAt)}
            </Caption>
            {m.body ? <Body>{m.body}</Body> : null}
            {m.images.length > 0 ? (
              <View style={styles.photos}>
                {m.images.map((img, i) => (
                  <Pressable key={img.id} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1}, open full size`} onPress={() => void Linking.openURL(img.url)}>
                    <Image source={{ uri: img.url }} style={styles.photo} resizeMode="cover" />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {seenAfterId === m.id ? <Caption style={styles.seen}>Seen</Caption> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  bubble: { maxWidth: "90%", gap: spacing.xs, padding: spacing.md, borderRadius: radii.md },
  seen: { alignSelf: "flex-end" },
  flagWord: { fontWeight: "600" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  photo: { width: 96, height: 96, borderRadius: radii.sm },
});
