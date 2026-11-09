import { MAX_BULK_STUDENTS } from "@school-kit/types";
import { ApiError } from "../api-client";

export interface IntakeReviewRow {
  rowNumber: number;
  admissionNumber: string;
  name: string;
  dateOfBirth: string;
  gender: string;
  email: string;
}
export interface IntakeReview {
  rows: IntakeReviewRow[];
  alreadySaved: number;
  placement: { classLabel: string; termLabel: string } | null;
}

export function intakeReviewSummary(review: IntakeReview) {
  return {
    createCount: review.rows.length,
    requestCount: Math.ceil(review.rows.length / MAX_BULK_STUDENTS),
    enrollmentCount: review.placement ? review.rows.length : 0,
    alreadySaved: review.alreadySaved,
  };
}

/** A failed response is not proof that the server rolled back the write. */
export function intakeOutcomeUnknown(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

export function validIntakeDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
