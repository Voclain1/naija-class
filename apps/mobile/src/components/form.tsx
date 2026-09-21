import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { Label } from "./ui";

// CP9 — the form pieces the admin screens share: a labelled text box, three
// day/month/year boxes, and a row of choice chips.
//
// The same shapes the "add a student" screen established (CP4c), lifted out
// so the event, parent, payment and expense forms look and behave alike —
// the same error placement, the same 44pt tap targets, the same "no date
// picker" rule for dates.

export function FieldError({ message }: { message?: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return <Text style={[styles.error, { color: colors.danger }]}>{message}</Text>;
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  keyboardType = "default",
  multiline = false,
  placeholder,
  maxLength,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string | null;
  keyboardType?: "default" | "phone-pad" | "email-address" | "decimal-pad" | "number-pad";
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  autoCapitalize?: "none" | "sentences" | "words";
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
        style={[
          multiline ? styles.textarea : styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      />
      <FieldError message={error} />
    </View>
  );
}

export interface DateBoxValues {
  day: string;
  month: string;
  year: string;
}

/** Day, month and year as three number boxes — never a picker (student-form.ts, rule 2). */
export function DateBoxes({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: DateBoxValues;
  onChange: (next: DateBoxValues) => void;
  error?: string | null;
}) {
  const { colors } = useTheme();
  function box(key: keyof DateBoxValues, placeholder: string, width: number) {
    return (
      <TextInput
        value={value[key]}
        onChangeText={(text) => onChange({ ...value, [key]: text.replace(/[^0-9]/g, "") })}
        keyboardType="number-pad"
        maxLength={key === "year" ? 4 : 2}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={`${label}, ${placeholder.toLowerCase()}`}
        style={[
          styles.input,
          styles.dateBox,
          {
            width,
            color: colors.foreground,
            backgroundColor: colors.card,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
      />
    );
  }
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <View style={styles.dateRow}>
        {box("day", "Day", 64)}
        {box("month", "Month", 72)}
        {box("year", "Year", 92)}
      </View>
      <FieldError message={error} />
    </View>
  );
}

export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  error?: string | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      {label ? <Label>{label}</Label> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(option.value)}
              style={[
                styles.chip,
                { borderColor: colors.primary, backgroundColor: active ? colors.primary : "transparent" },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.primary }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  textarea: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  dateRow: { flexDirection: "row", gap: spacing.sm },
  dateBox: { textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  error: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
});
