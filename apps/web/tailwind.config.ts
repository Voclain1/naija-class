import type { Config } from "tailwindcss";
// tailwindcss-animate is a CJS-only package (no "type": "module" in its
// package.json, single `module.exports = plugin(...)`). Node's CJS interop
// resolves the default import to that `module.exports` value, which is
// exactly the plugin object Tailwind expects. Plain default-import works;
// no `import * as` wrapping needed.
//
// Why this is `import` rather than `require`: tailwind.config.ts is loaded
// by Tailwind's ESM-aware loader (Next 15 / Turbopack), and `require` is
// not defined in that scope — see CLAUDE.md "ESM module resolution" for
// the project-wide rule.
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        // Display alias retained for existing callers; both tokens now map
        // to DM Sans on body. In-var fallbacks prevent an invalid font stack.
        sans: ["var(--font-sans, ui-sans-serif)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif, ui-serif)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        brandAccent: "hsl(var(--brand-accent))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // look-and-feel Part 2, D5's second motion use: a saved row SETTLES.
        // An emerald wash that recedes, rather than a badge that pops in and
        // out — the row was already the thing the teacher was looking at, so
        // the feedback belongs on the row and should leave on its own.
        // Paired with `motion-reduce:animate-none` at every call site (D6).
        settle: {
          "0%": { backgroundColor: "hsl(var(--primary) / 0.16)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        settle: "settle 900ms ease-out 1",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
};

export default config;
