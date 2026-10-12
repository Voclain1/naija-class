// Prisma CLI config (Prisma 7; docs/modules/prisma-7-upgrade.md).
//
// The CLI no longer reads .env: every script in package.json already wraps it
// in `dotenv -e ../../.env`, and production (Fly secrets, CI) sets the
// variables itself, so nothing is loaded here.
//
// Migrations run as the migration role, school_kit, through DIRECT_URL (what
// schema.prisma's `directUrl` was). The app never uses this file: it connects
// as app_user through the pg adapter (src/prisma-client.ts). `generate` needs
// no URL, so an unset DIRECT_URL is fine for it (the Docker build).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
