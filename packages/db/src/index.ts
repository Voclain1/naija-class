export { PrismaClient, Prisma } from "../generated/client/index.js";
export type * from "../generated/client/index.js";
export { basePrisma, withTenant } from "./tenant-client.js";
export {
  DEFAULT_CLASS_LEVELS,
  type DefaultClassLevel,
} from "./seeds/class-levels.js";