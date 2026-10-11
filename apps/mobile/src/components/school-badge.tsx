import { useQuery } from "@tanstack/react-query";
import { schoolInitials } from "@school-kit/types";
import { Image, StyleSheet, Text, View } from "react-native";

import { getSchoolLogoUrl } from "../lib/api/school-identity";
import type { Principal } from "../lib/auth/principal";
import { queryKeys } from "../lib/query/keys";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";

// The school's own logo and name at the top of each home screen
// (docs/modules/school-identity.md, slice 1). The app's store name, icon and
// splash stay SchoolKit: there is one app for every school.

const LOGO_SIZE = 36;
// Inside the signed URL's hour, so a shown logo never points at a dead link.
const LOGO_STALE_MS = 45 * 60 * 1000;

export function SchoolBadge({ principal, name }: { principal: Principal; name: string | null | undefined }) {
  const { colors } = useTheme();
  const logo = useQuery({
    queryKey: queryKeys.schoolLogo(principal),
    queryFn: () => getSchoolLogoUrl(principal),
    staleTime: LOGO_STALE_MS,
    meta: { persist: false },
  });

  if (!name) return null;

  return (
    <View style={styles.row} accessibilityRole="header">
      {logo.data ? (
        <Image
          source={{ uri: logo.data }}
          style={[styles.logo, { borderRadius: radii.sm }]}
          resizeMode="contain"
          accessibilityLabel={`${name} logo`}
        />
      ) : (
        <View
          style={[styles.logo, styles.initials, { backgroundColor: colors.primary, borderRadius: radii.sm }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.initialsText, { color: colors.primaryForeground }]}>
            {schoolInitials(name)}
          </Text>
        </View>
      )}
      <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  initials: { alignItems: "center", justifyContent: "center" },
  initialsText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  name: { flexShrink: 1, fontFamily: fonts.sansSemibold, fontSize: fontSizes.bodyLarge },
});
