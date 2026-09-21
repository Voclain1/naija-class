import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { useSession } from "../../src/lib/auth/session";
import { visibleStaffTabs } from "../../src/lib/staff/tabs";
import { useTheme } from "../../src/theme/theme-provider";
import { fontSizes, fonts } from "../../src/theme/tokens";

// CP8 — the staff tab bar.
//
// D29: the bar carries DAILY destinations, not all ten surfaces. Home, Marks,
// Classes, Notes. Everything else — curriculum, the register, report comments,
// timetable, calendar, collections, profile — is reached from the dashboard
// grid and stays fully routable; `href: null` hides a route from the bar
// WITHOUT removing it.
//
// That hiding is load-bearing, not cosmetic: expo-router turns every direct
// child of a Tabs layout into a tab, so a new staff folder appears in the bar
// unless it is listed here. A redesign that strands a screen has removed a
// feature, so each hidden route is named explicitly rather than left to
// chance.

export default function StaffTabsLayout() {
  const { colors } = useTheme();
  const { staff } = useSession();
  // CP4 D32: Marks, Classes and Notes read /teacher-scope/*, which the server
  // refuses without the teacher role. An owner is shown only what works.
  const tabs = visibleStaffTabs(staff?.roles);
  const hideUnless = (name: Parameters<typeof tabs.has>[0]) => (tabs.has(name) ? {} : { href: null });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: fontSizes.caption },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="gradebook"
        options={{
          ...hideUnless("gradebook"),
          title: "Marks",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="create-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          ...hideUnless("classes"),
          title: "Classes",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="lesson-notes"
        options={{
          ...hideUnless("lesson-notes"),
          title: "Notes",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />

      {/* Reachable, deliberately not in the bar. */}
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="report-cards" options={{ href: null }} />
      <Tabs.Screen name="curriculum" options={{ href: null }} />
      <Tabs.Screen name="collections" options={{ href: null }} />
      <Tabs.Screen name="timetable" options={{ href: null }} />
      <Tabs.Screen name="calendar" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}
