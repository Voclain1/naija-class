// cp4 fixture barrel. Tests import everything from "../fixtures/index.js".
//
// Design principle (cp4): API-FIRST SETUP, UI-ONLY ASSERTIONS. Academic
// structure, invitations, and assignments are built over HTTP / the tenant
// client; the browser is reserved for asserting the teacher portal. Built so
// slice 13's acceptance #11 rollup can reuse the same helpers.

export { API_BASE_URL, createApiContext } from "./api.js";
export {
  loginAsAdmin,
  loginAsTeacher,
  type AdminSession,
  type TeacherSession,
} from "./session.js";
export {
  setupAcademicStructure,
  assignTeacher,
  armId,
  type AcademicStructure,
  type ArmSpec,
} from "./academic.js";
export { inviteAndAcceptTeacher, type InvitedTeacher } from "./teacher.js";
export { uniqueSuffix, uniquePhone } from "./unique.js";
