import { Alert, Linking, StyleSheet, View } from "react-native";
import { describeSubmissionFile, type AssignmentFileUrlDto, type SubmissionFileDto } from "@school-kit/types";

import { ApiError } from "../lib/api/client";
import { spacing } from "../theme/tokens";
import { Button } from "./ui";

// Phase 9 / CP4.2 — the photos and PDFs on a piece of handed-in work (Q8).
// Each is private: "View" asks the API for a five-minute link (an audited
// read) and opens it. Shared by the student, staff and parent screens; each
// passes the link call its own principal is allowed to make.

export function SubmissionFiles({
  files,
  getUrl,
  onRemove,
  removing,
}: {
  files: readonly SubmissionFileDto[];
  getUrl: (fileId: string) => Promise<AssignmentFileUrlDto>;
  /** Staged files only: the student may take one back before handing in. */
  onRemove?: (fileId: string) => void;
  removing?: boolean;
}) {
  if (files.length === 0) return null;

  async function open(fileId: string): Promise<void> {
    try {
      const { url } = await getUrl(fileId);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Can't open the file", e instanceof ApiError ? e.message : "Check your connection and try again.");
    }
  }

  return (
    <View style={styles.list}>
      {files.map((f, i) => (
        <View key={f.id} style={styles.row}>
          <Button title={`View ${describeSubmissionFile(files, i)}`} variant="secondary" onPress={() => void open(f.id)} />
          {onRemove ? (
            <Button title="Remove" variant="secondary" disabled={removing} onPress={() => onRemove(f.id)} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
