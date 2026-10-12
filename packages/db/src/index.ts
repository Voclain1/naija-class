export { PrismaClient, Prisma } from "./generated/prisma/client.js";
export type * from "./generated/prisma/client.js";
export {
  createPrismaClient,
  poolMaxFromEnv,
  DEFAULT_POOL_MAX,
  POOL_ACQUIRE_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  type CreatePrismaClientOptions,
} from "./prisma-client.js";
export { basePrisma, withTenant, isRetryableConnectionError } from "./tenant-client.js";
export { withGuardian } from "./with-guardian.js";
export {
  DEFAULT_CLASS_LEVELS,
  type DefaultClassLevel,
} from "./seeds/class-levels.js";
export { defaultArmFor, type DefaultArm, type DefaultArmSourceLevel } from "./seeds/class-arms.js";
export { DEFAULT_SUBJECTS, type DefaultSubject } from "./seeds/subjects.js";
export {
  DEFAULT_GRADING_SCHEME_NAME,
  DEFAULT_GRADING_COMPONENTS,
  DEFAULT_GRADE_BOUNDARIES,
  type DefaultGradingComponent,
  type DefaultGradeBoundary,
} from "./seeds/grading.js";
export { SYSTEM_ROLE_SEEDS, type SystemRoleSeed } from "./seeds/system-roles.js";
// The shared new-school bootstrap. Read its header before adding a caller —
// it has a GUC precondition and a transaction-timeout requirement that are
// not visible from the call site.
export { applySchoolDefaults } from "./seeds/school-defaults.js";