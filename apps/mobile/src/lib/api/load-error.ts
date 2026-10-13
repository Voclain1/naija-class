import { ApiError, ApiNetworkError } from "./client";

// What a screen says when its data failed to load, and whether "Try again"
// can help.
//
// Before this, every screen said "We couldn't load X. Try again shortly."
// whatever had gone wrong (mobile review, 2026-10-13). A report card that
// has not been released answers 404, and a screen that is not this person's
// answers 403. Retrying changes neither, so telling them to try again sent
// them round in a circle. Only a lost connection or a server fault is worth
// another go.

export interface LoadFailure {
  message: string;
  /** True when trying again could succeed: no connection, or a server fault. */
  retry: boolean;
}

export interface LoadFailureWording {
  /** What failed to load, as it reads after "We couldn't load": "your classes". */
  what: string;
  /** The sentence for a 404, when the screen knows what one means here. */
  notFound?: string;
  /** The sentence for a 403, when the screen knows what one means here. */
  forbidden?: string;
}

export function describeLoadError(error: unknown, wording: LoadFailureWording): LoadFailure {
  if (error instanceof ApiNetworkError) {
    return {
      message: "Couldn't reach SchoolKit. Check your internet connection and try again.",
      retry: true,
    };
  }
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return {
        message:
          wording.forbidden ??
          "Your account can't open this. If you think it should, ask your school administrator.",
        retry: false,
      };
    }
    if (error.status === 404) {
      return {
        message: wording.notFound ?? "This isn't available any more. It may have been removed.",
        retry: false,
      };
    }
  }
  return { message: `We couldn't load ${wording.what}. Try again shortly.`, retry: true };
}
