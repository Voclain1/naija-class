import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>School Kit</Text>
      <Text style={styles.subtitle}>
        Phase 0 — scaffold up. Parent and student features start Phase 4.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#444",
    textAlign: "center",
  },
});
