# AGENTS.md

This repo is normally driven with Claude Code, whose build/architecture/
convention guide lives in `CLAUDE.md` at this same root. That file is **not**
Claude-Code-specific — read it in full before making any change. Every "Hard
rule" in it (multi-tenancy, money, auth, AI, git) applies no matter which
coding agent is doing the work.

## If you are Codex (or any agent other than Claude Code) picking this up temporarily

1. Read `CLAUDE.md` first, in full. It is the canonical source of truth for
   tech stack, monorepo layout, naming conventions, and the hard rules.
2. Then read `docs/CODEX_HANDOFF.md`. It exists specifically to carry context
   that would normally live in Claude Code's private, cross-session memory
   (`~/.claude/...` on the maintainer's machine) — a store you have no access
   to. It covers environment quirks, hard-won debugging lessons, and the
   state of things as of the handoff date.
3. `docs/deferred.md` tracks known-but-not-yet-fixed issues and follow-ups —
   check it before assuming something broken or missing is news.
4. `docs/journal/` has dated session logs from past work (the latest entry
   is the newest file there; `docs/journal/2026-10-08.md` is a catch-up
   covering 2026-09-06 to 2026-10-08). Skim recent entries if
   `docs/deferred.md` and `docs/CODEX_HANDOFF.md` don't answer a question.
5. Work the same way this project already works: one module per PR,
   Conventional Commits, never commit directly to `main`, never touch
   `.env`/secrets/`dist/`/`node_modules/`/generated Prisma client, and follow
   the multi-tenancy/money/auth/AI hard rules in `CLAUDE.md` exactly — those
   exist to prevent cross-tenant data leaks and real financial bugs, not as
   style preferences.
6. Before finishing a session: add a dated entry to `docs/journal/` in the
   same style as existing entries, and update `docs/CODEX_HANDOFF.md`'s
   "Latest state" section. This is the only continuity mechanism available
   to whoever (human or agent) picks the project up next, since you don't
   have write access to Claude Code's memory store.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
