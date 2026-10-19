"use client";

import { use } from "react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ why?: string }>;
}

// Next.js 15: route params are a Promise; use() unwraps them in a client
// component, same pattern as apps/web/src/app/invitations/[token]/page.tsx.
// `?why=old-rules`: sign-in sent the person here because their password was
// set under the older rules (the token came from sign-in, not an email).
export default function ResetPasswordPage({ params, searchParams }: Props) {
  const { token } = use(params);
  const { why } = use(searchParams);
  return <ResetPasswordForm token={token} oldRules={why === "old-rules"} />;
}
