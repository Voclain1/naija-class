import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";

import guideMarkdown from "../../../../../../docs/onboarding-guide.md";

// The single source of truth is docs/onboarding-guide.md — this page renders
// it as-is rather than maintaining a second copy in apps/web. See
// next.config.mjs's webpack() for how the import above resolves (inlined at
// build time via `asset/source`, not a runtime file read).
//
// rehypeSlug generates heading ids that match the guide's own internal
// anchor links (e.g. "[Fee catalog](#9-fee-catalog)") — without it those
// links would have nothing to scroll to, since react-markdown doesn't
// generate heading ids on its own.
//
// The guide's only external link (the demo video) has to open in a new tab —
// react-markdown renders a plain <a> otherwise, and following it in-place
// would drop the reader out of the app mid-guide. Internal anchor links
// (#9-fee-catalog and friends) are left exactly as they were.
const markdownComponents = {
  a({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
    const isExternal = href?.startsWith("http");
    return (
      <a
        href={href}
        {...props}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
};

// Server component, no data fetching: this is genuinely just "render this
// static file," so there's nothing here that needs "use client".
export default function HelpGuidePage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <article
        className="
          prose prose-sm max-w-none dark:prose-invert
          prose-headings:font-serif prose-headings:font-medium
          prose-a:text-primary
        "
      >
        <ReactMarkdown rehypePlugins={[rehypeSlug]} components={markdownComponents}>
          {guideMarkdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
