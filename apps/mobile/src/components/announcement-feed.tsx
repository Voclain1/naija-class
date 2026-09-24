import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AnnouncementFeedItemDto } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { Body, Card, Heading, Label } from "./ui";

// The school's announcements as a family reads them
// (docs/modules/announcements.md). Shared by the parent and student screens:
// both read a feed of the same shape from their own endpoint, so they share
// one renderer and cannot drift into two different ideas of "unread".
//
// Reading is what marks one read. There is no "mark as read" button, because
// someone who has the message on screen HAS read it, and a button is one more
// thing to forget — which would leave a school looking at an unread count
// that means nothing. Each mark is fire-and-forget: a failed one leaves the
// item unread, which is the safe direction.

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AnnouncementFeed({
  items,
  onRead,
}: {
  items: readonly AnnouncementFeedItemDto[];
  /** Marks one announcement read. Called once per item, per app session. */
  onRead: (id: string) => void;
}) {
  const { colors } = useTheme();
  const marked = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const item of items) {
      if (item.readAt !== null || marked.current.has(item.id)) continue;
      marked.current.add(item.id);
      onRead(item.id);
    }
  }, [items, onRead]);

  return (
    <>
      {items.map((item) => {
        const unread = item.readAt === null;
        return (
          <Card key={item.id}>
            <View
              style={[
                styles.row,
                // The unread mark is a left edge, not a dot: it survives a
                // narrow screen and does not compete with the urgent badge.
                unread ? { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.sm } : null,
              ]}
            >
              <View style={styles.titleRow}>
                <Heading>{item.title}</Heading>
                {item.urgent ? (
                  <View style={[styles.badge, { backgroundColor: colors.danger }]}>
                    <Text style={[styles.badgeText, { color: colors.background }]}>Urgent</Text>
                  </View>
                ) : null}
              </View>
              <Label>{when(item.createdAt)}</Label>
              <Body>{item.body}</Body>
            </View>
          </Card>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  badge: { borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
});
