import type { AuthMeRoleDto } from "@school-kit/types";

// Shared by LoginForm (post-login redirect) and HelpTopbar ("Back" link) —
// one "what's this role's home page" computation. Added 2026-08-02 alongside
// the bursar admin-shell-access fix: before that fix, login always redirected
// to /dashboard and bursar was immediately bounced out to /teacher/dashboard
// by RequireAuth, so the wrong redirect target never mattered. Now that
// bursar reaches the (admin) shell for real, landing them on /dashboard is a
// dead end — bursar has no `dashboard.read` permission, so that page's data
// fetch 403s and the page spins forever. bursar goes to /finance/dashboard
// instead, the one page their role can actually use.
export function homeRouteForRoles(roles: AuthMeRoleDto[]): string {
  if (roles.some((r) => r.key === "owner" || r.key === "admin")) return "/dashboard";
  if (roles.some((r) => r.key === "bursar")) return "/finance/dashboard";
  // Phase 9 / CP3.1 — the Health officer's only page.
  if (roles.some((r) => r.key === "health_officer")) return "/health";
  // Phase 9 / CP6.1 — the Librarian's pages.
  if (roles.some((r) => r.key === "librarian")) return "/library";
  // Phase 9 / CP6b.2 — the House master's page.
  if (roles.some((r) => r.key === "house_master")) return "/boarding";
  if (roles.some((r) => r.key === "teacher")) return "/teacher/dashboard";
  // 2026-10-19 (the role audit): these four are normally added on top of a
  // main role, but a school can give one on its own — an office clerk who
  // only reads parents' messages. Sent to the teacher shell, such a person met
  // a teacher's menu where every page refused them; their own page is here.
  if (roles.some((r) => r.key === "admission_officer")) return "/admissions";
  if (roles.some((r) => ["principal", "head_teacher", "inbox_officer"].includes(r.key))) return "/messages";
  return "/teacher/dashboard";
}
