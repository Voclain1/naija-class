import { Alert, Linking } from "react-native";
import { callSchoolHref } from "@school-kit/types";

import { Button } from "./ui";

// "Call the school" (docs/modules/the-school-day.md Part D).
//
// The reply path, and deliberately the ONLY one. D11 refuses general
// messaging: two-way chat brings adult–child contact into a product used by
// minors, with a safeguarding duty, moderation and retention this project
// cannot carry, and teacher↔student messaging is a category to refuse on
// purpose rather than arrive at.
//
// So a parent who reads "the gate is closed tomorrow" does what they already
// do — ring the school — with the friction removed. One number, the school's
// own, and no inbox pretending to be a conversation.
//
// Renders NOTHING when the school has no number on file. A disabled button
// would tell a worried parent the feature exists and has been taken away from
// them; an absent one simply leaves them where they were.

export function CallSchool({
  phone,
  variant = "secondary",
}: {
  phone: string | null | undefined;
  variant?: "primary" | "secondary";
}) {
  const href = callSchoolHref(phone);
  if (href === null) return null;

  async function call(): Promise<void> {
    try {
      const supported = await Linking.canOpenURL(href!);
      if (!supported) {
        // A tablet with no dialler is the real case here. Showing the number
        // is more use than an error: it can be read out or typed into another
        // phone.
        Alert.alert("Call the school", `This device can't make calls. The school's number is ${phone}.`);
        return;
      }
      await Linking.openURL(href!);
    } catch {
      Alert.alert("Call the school", `We couldn't open the dialler. The school's number is ${phone}.`);
    }
  }

  return <Button title="Call the school" variant={variant} onPress={() => void call()} />;
}
