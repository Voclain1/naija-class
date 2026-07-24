"use client";

import { use } from "react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

interface Props {
  params: Promise<{ token: string }>;
}

// Next.js 15: route params are a Promise; use() unwraps them in a client
// component, same pattern as apps/web/src/app/invitations/[token]/page.tsx.
export default function ResetPasswordPage({ params }: Props) {
  const { token } = use(params);
  return <ResetPasswordForm token={token} />;
}
