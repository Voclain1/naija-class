import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// The few controls the lab app needs. Large targets on purpose: lab mice and
// trackpads, children, a timed exam.

type Variant = "primary" | "outline" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-input bg-background hover:bg-muted",
  ghost: "hover:bg-muted",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-12 w-full rounded-md border border-input bg-background px-3 text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border bg-card p-6 shadow-sm ${className}`}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {children}
    </p>
  );
}

/** A centred column for the screens before and after the exam. */
export function Screen({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-4 py-10">{children}</main>;
}
