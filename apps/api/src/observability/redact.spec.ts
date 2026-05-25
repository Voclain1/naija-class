import { describe, expect, it } from "vitest";

import { redactString, redactValue } from "./redact";

// The redactor is the only thing standing between user PII and a third-party
// error-reporting service. Tests cover (a) value-shape regexes, (b)
// key-shape masks, (c) nested traversal, (d) bounded depth, (e) non-string
// passthrough.

describe("redactString", () => {
  it("masks email addresses", () => {
    expect(redactString("user mayowa@example.com not found")).toBe(
      "user [REDACTED_EMAIL] not found",
    );
  });

  it("masks multiple emails in one string", () => {
    expect(redactString("a@x.io and b@y.io")).toBe(
      "[REDACTED_EMAIL] and [REDACTED_EMAIL]",
    );
  });

  it("masks Nigerian phone numbers with +234 prefix", () => {
    expect(redactString("call +2348012345678 now")).toBe(
      "call [REDACTED_PHONE] now",
    );
  });

  it("masks 11-digit Nigerian phone numbers starting 0", () => {
    expect(redactString("call 08012345678 now")).toBe(
      "call [REDACTED_PHONE] now",
    );
  });

  it("does not mask short numeric strings (status codes, IDs)", () => {
    expect(redactString("status 404")).toBe("status 404");
  });

  it("leaves harmless text alone", () => {
    expect(redactString("School Kit listening on port 4000")).toBe(
      "School Kit listening on port 4000",
    );
  });
});

describe("redactValue", () => {
  it("returns primitives unchanged", () => {
    expect(redactValue(42)).toBe(42);
    expect(redactValue(true)).toBe(true);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(undefined)).toBe(undefined);
  });

  it("masks values by key name (password)", () => {
    const out = redactValue({ email: "a@b.io", password: "hunter2" }) as Record<
      string,
      unknown
    >;
    expect(out.password).toBe("[REDACTED]");
    // Email still gets value-masked even though the key isn't sensitive.
    expect(out.email).toBe("[REDACTED_EMAIL]");
  });

  it("masks values by key name (token, bvn, nin, otp, authorization)", () => {
    const out = redactValue({
      token: "abc",
      bvn: "22123456789",
      nin: "11111111111",
      otp: "123456",
      authorization: "Bearer abc",
    }) as Record<string, unknown>;
    expect(out.token).toBe("[REDACTED]");
    expect(out.bvn).toBe("[REDACTED]");
    expect(out.nin).toBe("[REDACTED]");
    expect(out.otp).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
  });

  it("traverses nested objects", () => {
    const out = redactValue({
      user: { email: "a@b.io", profile: { phone: "+2348012345678" } },
    }) as { user: { email: string; profile: { phone: string } } };
    expect(out.user.email).toBe("[REDACTED_EMAIL]");
    expect(out.user.profile.phone).toBe("[REDACTED_PHONE]");
  });

  it("traverses arrays", () => {
    const out = redactValue([
      { email: "a@b.io" },
      { email: "c@d.io" },
    ]) as Array<{ email: string }>;
    expect(out[0].email).toBe("[REDACTED_EMAIL]");
    expect(out[1].email).toBe("[REDACTED_EMAIL]");
  });

  it("bounds traversal depth so a pathological input cannot hang the SDK", () => {
    // 12 levels deep with an email at the bottom. Depth cap is 8.
    let nested: Record<string, unknown> = { email: "a@b.io" };
    for (let i = 0; i < 12; i++) nested = { inner: nested };
    const out = redactValue(nested);
    // Just assert the function terminates and returns *something*. The
    // depth-truncated payload is not required to be inspectable; the point
    // is that we did not recurse forever.
    expect(out).toBeDefined();
  });
});

// -------------------------------------------------------------------------
// Phase 1 / Slice 4 — Student PII closure test.
//
// Student is the first DTO with real children's PII. This test is the
// acceptance criterion for the slice-4 PII-redaction work: it asserts that
// every Student field that would identify a child gets masked when an
// event carrying that object passes through the Sentry beforeSend pipeline
// (which is what calls redactValue on event.extra/contexts/data).
//
// The leak path being closed: HttpExceptionFilter's catch-all branch calls
// Sentry.captureException(exception, { extra: ... }). If a future
// `extra` ever includes a Student row (e.g. for debugging a 500), the
// redactor must strip identifying fields before the event ships.
// -------------------------------------------------------------------------

describe("redactValue — Student PII closure (Phase 1 / Slice 4)", () => {
  // A Student row as the Prisma client returns it. Field names mirror the
  // Prisma model + the StudentDto. Both camelCase and snake_case forms are
  // exercised because audit metadata and raw $queryRaw results use both.
  const student = {
    id: "stu-abc-123",
    schoolId: "sch-xyz-789",
    admissionNumber: "ADM/2025/0001",
    firstName: "Ada",
    middleName: "Chioma",
    lastName: "Okafor",
    dateOfBirth: "2014-03-15",
    gender: "FEMALE",
    photoUrl: "https://r2.example/s/abc.jpg",
    address: "12 Allen Avenue, Ikeja, Lagos",
    phone: "+2348012345678",
    email: "ada.okafor@example.com",
    bloodGroup: "O+",
    medicalNotes: "Asthma — keeps inhaler in school bag.",
    religion: "Christian",
    stateOfOrigin: "Anambra",
    nationality: "Nigerian",
    status: "ACTIVE",
    admittedAt: "2025-09-01T00:00:00.000Z",
    withdrawnAt: null,
    graduatedAt: null,
    notes: "Strong in mathematics.",
    createdAt: "2025-09-01T08:14:22.000Z",
    updatedAt: "2025-09-01T08:14:22.000Z",
  };

  const redacted = redactValue(student) as Record<string, unknown>;

  it("masks dateOfBirth (NDPR sensitive — child's birth date)", () => {
    expect(redacted.dateOfBirth).toBe("[REDACTED]");
  });

  it("masks first/middle/last name (identifying together with DOB)", () => {
    expect(redacted.firstName).toBe("[REDACTED]");
    expect(redacted.middleName).toBe("[REDACTED]");
    expect(redacted.lastName).toBe("[REDACTED]");
  });

  it("masks address", () => {
    expect(redacted.address).toBe("[REDACTED]");
  });

  it("masks medicalNotes (special-category health data under NDPR)", () => {
    expect(redacted.medicalNotes).toBe("[REDACTED]");
  });

  it("masks bloodGroup (health-adjacent)", () => {
    expect(redacted.bloodGroup).toBe("[REDACTED]");
  });

  it("masks email by value regex (the existing pipeline)", () => {
    expect(redacted.email).toBe("[REDACTED_EMAIL]");
  });

  it("masks phone by value regex (the existing pipeline)", () => {
    expect(redacted.phone).toBe("[REDACTED_PHONE]");
  });

  it("leaves non-identifying / non-PII fields alone (debuggability is preserved)", () => {
    // We deliberately do NOT mask ids, status, timestamps, admissionNumber,
    // nationality, religion, stateOfOrigin, notes, or photoUrl — those are
    // useful for debugging and don't on their own identify a child.
    expect(redacted.id).toBe("stu-abc-123");
    expect(redacted.status).toBe("ACTIVE");
    expect(redacted.admissionNumber).toBe("ADM/2025/0001");
    expect(redacted.nationality).toBe("Nigerian");
    expect(redacted.photoUrl).toBe("https://r2.example/s/abc.jpg");
  });

  it("masks snake_case variants too (raw $queryRaw rows, audit JSON)", () => {
    const raw = {
      first_name: "Ada",
      middle_name: "Chioma",
      last_name: "Okafor",
      date_of_birth: "2014-03-15",
      medical_notes: "Asthma",
      blood_group: "O+",
      phone: "+2348012345678",
      email: "ada@example.com",
    };
    const out = redactValue(raw) as Record<string, unknown>;
    expect(out.first_name).toBe("[REDACTED]");
    expect(out.middle_name).toBe("[REDACTED]");
    expect(out.last_name).toBe("[REDACTED]");
    expect(out.date_of_birth).toBe("[REDACTED]");
    expect(out.medical_notes).toBe("[REDACTED]");
    expect(out.blood_group).toBe("[REDACTED]");
    expect(out.phone).toBe("[REDACTED_PHONE]");
    expect(out.email).toBe("[REDACTED_EMAIL]");
  });

  it("masks Student PII nested under arbitrary parent keys (Sentry extra payload shape)", () => {
    // Simulates Sentry.captureException(err, { extra: { student } }) — the
    // redactor must walk through `extra` and strip the leaf fields.
    const eventExtra = {
      requestId: "req-abc",
      student: { ...student },
    };
    const out = redactValue(eventExtra) as {
      requestId: string;
      student: Record<string, unknown>;
    };
    expect(out.requestId).toBe("req-abc");
    expect(out.student.firstName).toBe("[REDACTED]");
    expect(out.student.dateOfBirth).toBe("[REDACTED]");
    expect(out.student.medicalNotes).toBe("[REDACTED]");
    expect(out.student.email).toBe("[REDACTED_EMAIL]");
    expect(out.student.phone).toBe("[REDACTED_PHONE]");
  });

  it("does NOT over-mask innocent keys that happen to contain the substring 'address'", () => {
    // "ipAddress" is a common Sentry/request-log field; if we matched it we
    // would clobber a useful debugging value. The `^address$` anchor in
    // SENSITIVE_KEY_RE is what prevents this — keep this assertion as a
    // regression guard.
    const out = redactValue({
      ipAddress: "127.0.0.1",
      addressLine1: "12 Allen Avenue",
    }) as Record<string, unknown>;
    expect(out.ipAddress).toBe("127.0.0.1");
    // addressLine1 stays unmasked under the strict-anchor rule. If a future
    // entity (Guardian, Branch) needs to mask addressLine1, add it
    // explicitly to SENSITIVE_KEY_RE rather than loosening the anchor.
    expect(out.addressLine1).toBe("12 Allen Avenue");
  });
});

// -------------------------------------------------------------------------
// Phase 1 / Slice 5 — Guardian PII closure test.
//
// Guardian adds two new workplace identifiers (occupation, employer) on
// top of the slice-4 surface. Name / phone / email / address are already
// covered by slice-4 rules; this block exists to pin the slice-5
// additions and to document what a Guardian event payload looks like
// after redaction (Sentry extra, audit metadata leaks, etc.).
// -------------------------------------------------------------------------

describe("redactValue — Guardian PII closure (Phase 1 / Slice 5)", () => {
  const guardian = {
    id: "gua-abc-123",
    schoolId: "sch-xyz-789",
    firstName: "Bola",
    lastName: "Okafor",
    relationship: "MOTHER",
    phone: "+2348012345678",
    email: "bola.okafor@example.com",
    occupation: "Accountant",
    employer: "Lagos Tax Services",
    address: "14 Bode Thomas, Surulere",
    notes: "Primary contact on weekdays.",
    createdAt: "2025-09-01T08:14:22.000Z",
    updatedAt: "2025-09-01T08:14:22.000Z",
  };

  const redacted = redactValue(guardian) as Record<string, unknown>;

  it("masks occupation (slice-5 addition — workplace identifier)", () => {
    expect(redacted.occupation).toBe("[REDACTED]");
  });

  it("masks employer (slice-5 addition — workplace identifier)", () => {
    expect(redacted.employer).toBe("[REDACTED]");
  });

  it("inherits slice-4 masking for first/last name, address, phone, email", () => {
    expect(redacted.firstName).toBe("[REDACTED]");
    expect(redacted.lastName).toBe("[REDACTED]");
    expect(redacted.address).toBe("[REDACTED]");
    expect(redacted.phone).toBe("[REDACTED_PHONE]");
    expect(redacted.email).toBe("[REDACTED_EMAIL]");
  });

  it("leaves non-identifying fields alone (debuggability is preserved)", () => {
    expect(redacted.id).toBe("gua-abc-123");
    expect(redacted.relationship).toBe("MOTHER");
  });

  it("masks snake_case variants too", () => {
    const raw = {
      first_name: "Bola",
      last_name: "Okafor",
      occupation: "Accountant",
      employer: "Lagos Tax Services",
      phone: "+2348012345678",
    };
    const out = redactValue(raw) as Record<string, unknown>;
    expect(out.first_name).toBe("[REDACTED]");
    expect(out.last_name).toBe("[REDACTED]");
    expect(out.occupation).toBe("[REDACTED]");
    expect(out.employer).toBe("[REDACTED]");
    expect(out.phone).toBe("[REDACTED_PHONE]");
  });
});
