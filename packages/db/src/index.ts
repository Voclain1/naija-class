export { PrismaClient, Prisma } from "../generated/client/index.js";
export type * from "../generated/client/index.js";
export { basePrisma, withTenant } from "./tenant-client.js";
export {
  DEFAULT_CLASS_LEVELS,
  type DefaultClassLevel,
} from "./seeds/class-levels.js";
export {
  DEFAULT_GRADING_SCHEME_NAME,
  DEFAULT_GRADING_COMPONENTS,
  DEFAULT_GRADE_BOUNDARIES,
  type DefaultGradingComponent,
  type DefaultGradeBoundary,
} from "./seeds/grading.js";
export { SYSTEM_ROLE_SEEDS, type SystemRoleSeed } from "./seeds/system-roles.js";