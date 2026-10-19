import { createHmac, timingSafeEqual } from "node:crypto";

import { resolveResultPinKey } from "../result-checker/result-pin-key.js";

// The code printed on an ID card (docs/modules/id-cards-and-store.md §3,
// owner's answer 3): `<school slug>.<card id>.<signature>`. The signature is
// an HMAC of the card id under the server key (RESULT_PIN_HMAC_KEY, under a
// label of its own), so a code cannot be forged or guessed, and it names the
// school, so the public check can set that school's GUC before reading the
// card. Rotating the key makes every printed code read as unrecognised.

const LABEL = "id-card:v1:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(cardId: string, key: string): string {
  return createHmac("sha256", key).update(LABEL + cardId).digest("base64url").slice(0, 22);
}

export function idCardToken(slug: string, cardId: string, key: string = resolveResultPinKey()): string {
  return `${slug}.${cardId}.${signature(cardId, key)}`;
}

/** The slug and card id a code names, or null if it is not one of ours. */
export function readIdCardToken(
  token: string,
  key: string = resolveResultPinKey(),
): { slug: string; cardId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [slug, cardId, sig] = parts as [string, string, string];
  if (!slug || !UUID_RE.test(cardId)) return null;
  const expected = Buffer.from(signature(cardId, key));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { slug, cardId };
}
