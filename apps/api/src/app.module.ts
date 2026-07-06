import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { PaystackModule } from "./common/paystack/paystack.module.js";
import { RedisAuthModule } from "./common/auth/redis-auth.module";
import { RedisThrottlerStorage } from "./common/auth/redis-throttler-storage";
import { HealthController } from "./health/health.controller";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { QueueModule } from "./common/queue";
import { StorageModule } from "./common/storage";
import { AcademicYearsModule } from "./modules/academic-years/academic-years.module";
import { AssessmentModule } from "./modules/assessment/assessment.module";
import { AttendanceModule } from "./modules/attendance/attendance.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ClassArmsModule } from "./modules/class-arms/class-arms.module";
import { ClassLevelsModule } from "./modules/class-levels/class-levels.module";
import { ClassSubjectsModule } from "./modules/class-subjects/class-subjects.module";
import { DebugModule } from "./modules/debug/debug.module";
import { DiscountsModule } from "./modules/discounts/discounts.module";
import { FeeCatalogModule } from "./modules/fee-catalog/fee-catalog.module";
import { FinanceModule } from "./modules/finance/finance.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { EnrollmentsModule } from "./modules/enrollments/enrollments.module";
import { GradingModule } from "./modules/grading/grading.module";
import { GuardiansModule } from "./modules/guardians/guardians.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { ReportCardsModule } from "./modules/report-cards/report-cards.module";
import { SchoolsModule } from "./modules/schools/schools.module";
import { SystemModule } from "./modules/system/system.module";
import { StudentsModule } from "./modules/students/students.module";
import { SubjectAttendanceModule } from "./modules/subject-attendance/subject-attendance.module";
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
    // RedisAuthModule must come before ThrottlerModule — ThrottlerModule's
    // useClass factory resolves RedisThrottlerStorage from the DI context,
    // which RedisAuthModule exports. Global modules register before feature
    // modules that consume them.
    RedisAuthModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: "default", ttl: 60000, limit: 200 }],
        storage,
      }),
    }),
    // Globals first: QueueModule wires BullMQ to Redis; StorageModule
    // picks the storage driver; PaystackModule wraps the Paystack API and
    // provides PaystackService to PaymentsModule. All three must be imported
    // before the feature modules that consume them.
    ScheduleModule.forRoot(),
    QueueModule,
    StorageModule,
    PaystackModule,
    SystemModule,
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
    AttendanceModule,
    SubjectAttendanceModule,
    ReportCardsModule,
    FeeCatalogModule,
    DiscountsModule,
    InvoicesModule,
    PaymentsModule,
    FinanceModule,
    ...(isProd ? [] : [DebugModule]),
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global IP-based rate limit: 200 req/min across all routes.
    // Per-endpoint overrides use @Throttle({ default: { ttl, limit } }).
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
