import { StyleSheet, View } from "react-native";

import type { MessageDto } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { radii, spacing } from "../theme/tokens";
import { Body, Caption } from "./ui";

// Phase 9 / CP8.1 — one conversation's messages (docs/modules/phase-9.md
// §17.8), for the parent app and the staff app. Your own messages sit on the
// right on a tinted background; theirs on the left on a card. No coloured
// edges (the project's no-accent-borders rule).

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function MessageThread({ messages, seenAfterId }: { messages: (MessageDto & { writtenBy?: string | null })[]; seenAfterId?: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={styles.list} accessibilityLabel="Messages">
      {messages.map((m) => (
        <View
          key={m.id}
          style={[
            styles.bubble,
            m.mine
              ? { alignSelf: "flex-end", backgroundColor: `${colors.primary}1A` }
              : { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
          ]}
        >
          <Caption>
            {m.author} · {when(m.sentAt)}
          </Caption>
          <Body>{m.body}</Body>
          {seenAfterId === m.id ? <Caption style={styles.seen}>Seen</Caption> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  bubble: { maxWidth: "90%", gap: spacing.xs, padding: spacing.md, borderRadius: radii.md },
  seen: { alignSelf: "flex-end" },
});
