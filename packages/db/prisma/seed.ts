// Seed the database with rows that every install needs.
//
// Currently: system roles only. System roles have school_id = NULL and
// is_system = true. They are referenced by key (e.g. 'owner', 'admin') from
// the application layer.
//
// The unique index on roles(school_id, key) treats NULL as distinct in
// Postgres, so a naive upsert against that constraint will not deduplicate.
// We dedupe by hand with findFirst + create. Re-running the seed is safe.

import { createPrismaClient } from "../src/prisma-client.js";
import { SYSTEM_ROLE_SEEDS } from "../src/seeds/system-roles.js";

// DATABASE_URL, as before Prisma 7: a no-argument PrismaClient used the
// schema's `url`, not `directUrl`.
const prisma = createPrismaClient(process.env.DATABASE_URL ?? "");

async function main() {
  for (const role of SYSTEM_ROLE_SEEDS) {
    const existing = await prisma.role.findFirst({
      where: { schoolId: null, key: role.key, isSystem: true },
      select: { id: true },
    });

    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: {
          name: role.name,
          description: role.description,
          permissions: role.permissions,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`  ↻ updated system role: ${role.key}`);
    } else {
      await prisma.role.create({
        data: {
          schoolId: null,
          key: role.key,
          name: role.name,
          description: role.description,
          isSystem: true,
          permissions: role.permissions,
        },
      });
      // eslint-disable-next-line no-console
      console.log(`  + created system role: ${role.key}`);
    }
  }
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
