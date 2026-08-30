/** Safe, actionable copy for the import mapping submission step. */
export function importMappingErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MISSING_REQUIRED_MAPPING"
  ) {
    return "Choose a column for each required field before continuing.";
  }
  return "We couldn’t save the column mapping. Review your selections and try again.";
}
