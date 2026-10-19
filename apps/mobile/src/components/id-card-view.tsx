import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { MyIdCardDto } from "@school-kit/types";

import { QrCode } from "./qr-code";

// The holder's ID card on screen (docs/modules/id-cards-and-store.md §3): the
// same front and back as the printed card, at bank-card proportions
// (85.6 × 54), scaled to the phone. Its QR code opens the school's check page,
// so the on-screen card can be checked like the plastic one.

const FALLBACK = "#0E5C43";

export function IdCardView({ data }: { data: MyIdCardDto & { card: NonNullable<MyIdCardDto["card"]> } }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width - 32, 420);
  const mm = w / 85.6;
  const { school, card } = data;
  const colour = school.primaryColor || FALLBACK;
  const face = { width: w, height: 54 * mm, borderRadius: 3 * mm };
  return (
    <View style={styles.wrap}>
      <View style={[styles.card, face]} accessibilityLabel={`ID card for ${card.name}`}>
        <View style={[styles.band, { backgroundColor: colour, height: 12 * mm, paddingHorizontal: 3 * mm, gap: 2 * mm }]}>
          {school.logoUrl ? (
            <Image source={{ uri: school.logoUrl }} style={{ width: 9 * mm, height: 9 * mm, borderRadius: 1.5 * mm, backgroundColor: "#fff" }} resizeMode="contain" />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "700", fontSize: 3.4 * mm }}>
              {school.name}
            </Text>
            {school.motto ? (
              <Text numberOfLines={1} style={{ color: "#fff", fontStyle: "italic", fontSize: 2.2 * mm }}>
                {school.motto}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ flex: 1, flexDirection: "row", padding: 2.5 * mm, gap: 2.5 * mm }}>
          {card.photoUrl ? (
            <Image source={{ uri: card.photoUrl }} style={{ width: 21 * mm, height: 27 * mm, borderRadius: mm }} accessibilityLabel="Photo" />
          ) : (
            <View style={[styles.noPhoto, { width: 21 * mm, height: 27 * mm, borderRadius: mm }]}>
              <Text style={{ color: "#5B6B72", fontSize: 2.4 * mm }}>No photo</Text>
            </View>
          )}
          <View style={{ flex: 1, justifyContent: "space-between" }}>
            <View>
              <Text style={{ color: colour, fontWeight: "700", fontSize: 2.2 * mm, letterSpacing: 0.3 * mm }}>
                {card.kind === "STUDENT" ? "STUDENT" : "STAFF"}
              </Text>
              <Text numberOfLines={2} style={{ color: "#13262E", fontWeight: "700", fontSize: 3.6 * mm }}>
                {card.name}
              </Text>
              {card.detail ? <Text style={{ color: "#13262E", fontSize: 2.6 * mm }}>{card.detail}</Text> : null}
              {card.number ? (
                <Text style={{ color: "#5B6B72", fontSize: 2.4 * mm }}>
                  {card.kind === "STUDENT" ? "Adm. no. " : "Staff no. "}
                  {card.number}
                </Text>
              ) : null}
            </View>
            <Text style={{ color: "#13262E", fontSize: 2.3 * mm }}>Valid for {card.validFor} session</Text>
          </View>
          <View style={{ justifyContent: "flex-end", alignItems: "center" }}>
            <QrCode value={card.verifyUrl} size={17 * mm} />
          </View>
        </View>
      </View>

      <View style={[styles.card, face, { padding: 4 * mm, justifyContent: "space-between" }]}>
        <View style={{ gap: mm }}>
          <Text style={{ color: colour, fontWeight: "700", fontSize: 2.6 * mm }}>If found, please return to</Text>
          <Text style={{ color: "#13262E", fontWeight: "700", fontSize: 3.2 * mm }}>{school.name}</Text>
          {school.address ? <Text style={{ color: "#13262E", fontSize: 2.6 * mm }}>{school.address}</Text> : null}
          {school.phone ? <Text style={{ color: "#13262E", fontSize: 2.6 * mm }}>Tel: {school.phone}</Text> : null}
        </View>
        <Text style={{ color: "#13262E", fontSize: 2.4 * mm, textAlign: "right" }}>Card no. {card.cardNumber}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, alignItems: "center" },
  card: { backgroundColor: "#ffffff", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: "#cfd6d9" },
  band: { flexDirection: "row", alignItems: "center" },
  noPhoto: { backgroundColor: "#eef1f2", alignItems: "center", justifyContent: "center" },
});
