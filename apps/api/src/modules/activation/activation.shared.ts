import { createHmac, timingSafeEqual } from "node:crypto";

import {
  ACTIVATION_LINK_TARGETS,
  SCHOOLKIT_SUPPORT,
  type ActivationEmailKind,
  type ActivationLinkTarget,
  type ActivationStage,
} from "@school-kit/types";

import { staffSiteUrl } from "../../common/school-site-url.js";
import { escapeHtml } from "../admissions/admissions.shared.js";
import { resolveResultPinKey } from "../result-checker/result-pin-key.js";

// Setup reminders (docs/modules/activation.md): the signed links and the email.
//
// Every link in a reminder goes through the API, which counts the click and
// then redirects. The link carries the school, the email row and a fixed
// target name, signed with an HMAC under the result-checker key with a label
// of its own (as the unsubscribe and admission-tracking links do). Nothing is
// stored, and the redirect only ever goes to a staff-area path picked from the
// fixed list below, never to an address taken from the link.

const LINK_LABEL = "activation-link:v1:";
const STOP_LABEL = "activation-stop:v1:";

function sign(label: string, parts: string[], key: string): string {
  return createHmac("sha256", key)
    .update(label + parts.join(":"))
    .digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function linkSignature(
  schoolId: string,
  emailId: string,
  target: ActivationLinkTarget,
  key: string = resolveResultPinKey(),
): string {
  return sign(LINK_LABEL, [schoolId, emailId, target], key);
}

export function linkSignatureValid(
  schoolId: string,
  emailId: string,
  target: string,
  sig: string,
): boolean {
  if (!isLinkTarget(target)) return false;
  return same(linkSignature(schoolId, emailId, target), sig);
}

export function stopSignature(
  schoolId: string,
  emailId: string,
  key: string = resolveResultPinKey(),
): string {
  return sign(STOP_LABEL, [schoolId, emailId], key);
}

export function stopSignatureValid(
  schoolId: string,
  emailId: string,
  sig: string,
): boolean {
  return same(stopSignature(schoolId, emailId), sig);
}

export function isLinkTarget(t: string): t is ActivationLinkTarget {
  return (ACTIVATION_LINK_TARGETS as readonly string[]).includes(t);
}

/** The API's public origin, where the click and stop links point. */
export function apiPublicUrl(): string {
  const set = process.env.API_PUBLIC_URL?.trim();
  if (set) return set.replace(/\/$/, "");
  return process.env.NODE_ENV === "production"
    ? "https://api.schoolkit.ng"
    : "http://localhost:4000";
}

export function clickUrl(
  schoolId: string,
  emailId: string,
  target: ActivationLinkTarget,
): string {
  return `${apiPublicUrl()}/api/v1/activation/c/${schoolId}/${emailId}/${target}/${linkSignature(schoolId, emailId, target)}`;
}

export function stopUrl(schoolId: string, emailId: string): string {
  return `${apiPublicUrl()}/api/v1/activation/stop/${schoolId}/${emailId}/${stopSignature(schoolId, emailId)}`;
}

/** The staff-area path for a target, given where the school is now. */
export function targetPath(
  target: ActivationLinkTarget,
  stage: ActivationStage,
): string {
  switch (target) {
    case "setup-call":
      return "/welcome?book=1";
    case "smart-import":
      return "/students/scan";
    case "help":
      return "/help/guide";
    case "next-step":
      if (stage === 1) return "/onboarding";
      if (stage === 2) return "/students";
      if (stage === 3) return "/enrollments";
      return "/dashboard";
  }
}

export function targetUrl(
  slug: string,
  target: ActivationLinkTarget,
  stage: ActivationStage,
): string {
  return staffSiteUrl(slug, targetPath(target, stage));
}

// ─── The email ─────────────────────────────────────────────────────────────

interface Step {
  subject: string;
  heading: string;
  lead: string;
  button: string;
}

/** What the email asks for: the school's next step, worded for the reminder it is. */
export function reminderStep(
  kind: ActivationEmailKind,
  stage: ActivationStage,
  schoolName: string,
): Step {
  const s = schoolName;
  if (stage === 1) {
    return {
      subject:
        kind === "THIRD"
          ? `Still here to help you set up ${s}`
          : `Finish setting up ${s} on SchoolKit`,
      heading: "Your school is nearly ready",
      lead: "The setup wizard takes about five minutes: your school's details, your logo and your school year. Pick up where you left off.",
      button: "Finish setup",
    };
  }
  if (stage === 2) {
    return {
      subject:
        kind === "FIRST"
          ? `Add your students to ${s} in 2 minutes`
          : kind === "SECOND"
            ? `${s} has no students yet`
            : `Still here to help you set up ${s}`,
      heading: "Add your students",
      lead: "Take a photo of a class register and Smart Import types the names in for you, or add them one by one. Everything else in SchoolKit works from your students.",
      button: "Add students",
    };
  }
  return {
    subject:
      kind === "THIRD"
        ? `Still here to help you set up ${s}`
        : `Put your students in their classes`,
    heading: "Put your students in their classes",
    lead: "Your students are in, but not yet in a class for this term. Registers, fees and report cards all work from class lists, so this is the step that makes them work.",
    button: "Put students in classes",
  };
}

export function reminderEmailHtml(p: {
  kind: ActivationEmailKind;
  stage: ActivationStage;
  schoolName: string;
  ownerFirstName: string | null;
  links: Record<ActivationLinkTarget, string>;
  stop: string;
}): string {
  const step = reminderStep(p.kind, p.stage, p.schoolName);
  const hello = p.ownerFirstName
    ? `Hello ${escapeHtml(p.ownerFirstName)},`
    : "Hello,";
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;padding:12px 20px;background:#0E5C43;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${label}</a>`;
  const smart =
    p.stage === 2
      ? `<p style="margin:0 0 16px">Have a register on paper? <a href="${p.links["smart-import"]}" style="color:#0E5C43;font-weight:600">Try Smart Import</a>.</p>`
      : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(step.subject)}</title></head>
<body style="margin:0;background:#F7F5EF;font-family:Helvetica,Arial,sans-serif;color:#13262E">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#ffffff;border-radius:12px;padding:28px 24px">
      <p style="margin:0 0 16px">${hello}</p>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${escapeHtml(step.heading)}</h1>
      <p style="margin:0 0 20px;line-height:1.55">${escapeHtml(step.lead)}</p>
      <p style="margin:0 0 20px">${btn(p.links["next-step"], escapeHtml(step.button))}</p>
      ${smart}
      <div style="background:#E8F3EE;border-radius:10px;padding:16px;margin:8px 0 0">
        <p style="margin:0 0 6px;font-weight:600">Would you like a hand?</p>
        <p style="margin:0 0 10px;line-height:1.5">Book a free 30-minute call and we will set it up with you.</p>
        <a href="${p.links["setup-call"]}" style="color:#0E5C43;font-weight:600">Book a setup call</a>
      </div>
    </div>
    <p style="margin:20px 0 6px;font-size:13px;color:#5B6B70;line-height:1.5">
      Questions? Email ${SCHOOLKIT_SUPPORT.email}, call ${SCHOOLKIT_SUPPORT.phoneDisplay}, or read the <a href="${p.links.help}" style="color:#5B6B70">Getting started guide</a>.
    </p>
    <p style="margin:0;font-size:12px;color:#5B6B70">You are getting this because you set up ${escapeHtml(p.schoolName)} on SchoolKit. <a href="${p.stop}" style="color:#5B6B70">Stop these emails</a>.</p>
  </div>
</body></html>`;
}

export function stoppedPageHtml(ok: boolean): string {
  const msg = ok
    ? "Done. You won't get any more setup reminders from SchoolKit."
    : "This link is not valid. If you keep getting setup reminders, email " +
      SCHOOLKIT_SUPPORT.email +
      ".";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setup reminders</title></head>
<body style="margin:0;background:#F7F5EF;font-family:Helvetica,Arial,sans-serif;color:#13262E">
<div style="max-width:480px;margin:48px auto;padding:0 16px"><div style="background:#ffffff;border-radius:12px;padding:28px 24px">
<h1 style="margin:0 0 12px;font-size:20px">Setup reminders</h1><p style="margin:0;line-height:1.55">${escapeHtml(msg)}</p></div></div></body></html>`;
}
