"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { usePortalPrefix, withPrefix } from "@/lib/portal-path";

// next/link for the parents' pages: an internal href gains /parents at a
// school's own address (lib/portal-path.ts). A drop-in for `import Link from
// "next/link"`; object hrefs and external links pass through unchanged.
export default function PortalLink({ href, ...props }: ComponentProps<typeof Link>) {
  const prefix = usePortalPrefix();
  return <Link href={typeof href === "string" ? withPrefix(prefix, href) : href} {...props} />;
}
