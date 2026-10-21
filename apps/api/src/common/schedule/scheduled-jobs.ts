import { ScheduleModule } from "@nestjs/schedule";

// The API's scheduled jobs (every @Cron method) run only when ScheduleModule is
// imported: without it the decorators are inert metadata and nothing registers
// them. SCHEDULED_JOBS=off leaves it out.
//
// For a rehearsal on a COPY of production (docs/runbooks/vps-migration.md),
// whose rows hold real families' phone numbers and emails: the copy must not
// send fee reminders, RSVP nudges or weekly summaries of its own. Any other
// value, or unset, runs the jobs as before.
export function scheduledJobsModules(env: { SCHEDULED_JOBS?: string } = process.env) {
  return env.SCHEDULED_JOBS?.trim().toLowerCase() === "off" ? [] : [ScheduleModule.forRoot()];
}
