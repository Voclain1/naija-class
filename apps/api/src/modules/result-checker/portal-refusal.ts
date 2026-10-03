import { NotFoundError, ValidationError } from "@school-kit/types";

import type { RedeemRefusal } from "./result-pin.service";

// What a SIGNED-IN family is told when a PIN is refused inside a portal
// (§21.4). They are identified and already see the term in their list, so
// each reason gets a message they can act on — unlike the public checker,
// which says the same thing for almost everything (§21.5).
export function portalRefusal(reason: RedeemRefusal): Error {
  switch (reason) {
    case "NOT_RELEASED":
      return new NotFoundError("No released results for this term.");
    case "PIN_INVALID":
      return new ValidationError("PIN_INVALID", "That PIN isn't valid. Check the 12 digits on the card.");
    case "PIN_WRONG_TERM":
      return new ValidationError("PIN_WRONG_TERM", "That PIN is for a different term.");
    case "PIN_OTHER_STUDENT":
      return new ValidationError("PIN_OTHER_STUDENT", "That PIN has already been used for another student.");
    case "PIN_USED_UP":
      return new ValidationError("PIN_USED_UP", "That PIN has no uses left.");
  }
}
