import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";

import { HealthController } from "./health/health.controller";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { QueueModule } from "./common/queue";
import { StorageModule } from "./common/storage";
import { AcademicYearsModule } from "./modules/academic-years/academic-years.module";
import { AssessmentModule } from "./modules/assessment/assessment.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ClassArmsModule } from "./modules/class-arms/class-arms.module";
import { ClassLevelsModule } from "./modules/class-levels/class-levels.module";
import { ClassSubjectsModule } from "./modules/class-subjects/class-subjects.module";
import { DebugModule } from "./modules/debug/debug.module";
import { EnrollmentsModule } from "./modules/enrollments/enrollments.module";
import { GradingModule } from "./modules/grading/grading.module";
import { GuardiansModule } from "./modules/guardians/guardians.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { ReportCardRenderModule } from "./modules/report-cards/render/report-card-render.module";
import { ReportCardsModule } from "./modules/report-cards/report-cards.module";
import { SchoolsModule } from "./modules/schools/schools.module";
import { StudentsModule } from "./modules/students/students.module";
import { SubjectsModule } from "./modules/subjects/subjects.module";
import { TeacherAssignmentsModule } from "./modules/teacher-assignments/teacher-assignments.module";
import { TeacherProfilesModule } from "./modules/teacher-profiles/teacher-profiles.module";
import { TeacherScopeModule } from "./modules/teacher-scope/teacher-scope.module";
import { TermsModule } from "./modules/terms/terms.module";
import { UsersModule } from "./modules/users/users.module";

// DebugModule exposes /api/v1/debug/sentry-test for verifying Sentry wiring.
// Gated at import time so production builds do not include the route. This
// is the canonical "dev-only" pattern: not a runtime guard inside the
// controller, but absence at module composition.
const isProd = process.env.NODE_ENV === "production";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env"],
    }),
    // Globals first: QueueModule wires BullMQ to Redis; StorageModule
    // picks the storage driver. Both expose providers downstream
    // modules depend on, so they must be imported before the feature
    // modules that consume them (ImportsModule).
    QueueModule,
    StorageModule,
    AuthModule,
    SchoolsModule,
    UsersModule,
    InvitationsModule,
    AcademicYearsModule,
    TermsModule,
    ClassLevelsModule,
    ClassArmsModule,
    SubjectsModule,
    ClassSubjectsModule,
    StudentsModule,
    GuardiansModule,
    EnrollmentsModule,
    TeacherProfilesModule,
    TeacherAssignmentsModule,
    TeacherScopeModule,
    ImportsModule,
    GradingModule,
    AssessmentModule,
    ReportCardsModule,
    ReportCardRenderModule,
    ...(isProd ? [] : [DebugModule]),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
