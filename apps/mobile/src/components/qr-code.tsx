import { useMemo } from "react";
import { View } from "react-native";

import { qrRuns } from "../lib/qr-runs";

// A QR code drawn with plain Views (the app has no SVG renderer). Each row's
// dark modules are merged into runs, so a typical card code is a few hundred
// small boxes rather than a thousand.

export function QrCode({ value, size }: { value: string; size: number }) {
  const { size: modules, rows } = useMemo(() => qrRuns(value), [value]);
  const quiet = 2;
  const cell = size / (modules + quiet * 2);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="QR code to check this card"
      style={{ width: size, height: size, backgroundColor: "#ffffff" }}
    >
      {rows.map((runs, r) =>
        runs.map((run) => (
          <View
            key={`${r}-${run.start}`}
            style={{
              position: "absolute",
              top: (r + quiet) * cell,
              left: (run.start + quiet) * cell,
              width: run.length * cell + 0.5,
              height: cell + 0.5,
              backgroundColor: "#000000",
            }}
          />
        )),
      )}
    </View>
  );
}
