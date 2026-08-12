import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";

import { AI_JOB_FORM_COMMENT, AI_JOB_SUBJECT_COMMENT, AI_QUEUE } from "../../../common/queue/index.js";
import { FormCommentsService, type FormCommentJobData } from "../form-comments.service.js";
import { ReportCommentsService, type SubjectCommentJobData } from "../report-comments.service.js";

// ---------------------------------------------------------------------------
// SubjectCommentProcessor — the sole @Processor on AI_QUEUE.
//
// One @Processor class per queue (see ImportsProcessor's note): @nestjs/bullmq
// spawns one BullMQ Worker per class, so a second class on this queue would
// load-balance AI jobs across competing workers. Later AI batch features add a
// branch in this dispatcher, not a new @Processor.
//
// concurrency 3: these jobs are network-bound (a short Haiku call), not
// memory-bound like the Chromium renders on REPORT_CARDS_QUEUE, so serialising
// to 1 would make a 40-student arm needlessly slow. It stays low because every
// concurrent job is real money against the school's token budget and holds a
// Neon connection for its two short transactions — the budget check is atomic
// (phase-5.md D5) so concurrency cannot overshoot the cap, but it does
// determine how fast a runaway batch burns it.
//
// DELIBERATELY NOT `tenantWorker`. That helper wraps the WHOLE job in one
// withTenant transaction, and phase-5.md D1 forbids an LLM call inside one: a
// generation takes 10-30s against a 5s interactive-transaction limit, and
// holding a Neon connection across a network call is the specific failure D1
// exists to prevent. generateForStudent owns its own short transactions with
// the call between them — the same structure ReportCardRenderProcessor uses to
// put a Chromium render between two short transactions. schoolId is still
// asserted here, exactly as that processor does.
// ---------------------------------------------------------------------------
@Processor(AI_QUEUE, { concurrency: 3 })
export class SubjectCommentProcessor extends WorkerHost {
  private readonly logger = new Logger(SubjectCommentProcessor.name);

  constructor(
    private readonly comments: ReportCommentsService,
    private readonly formComments: FormCommentsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === AI_JOB_SUBJECT_COMMENT) {
      return this.handleSubjectComment(job as Job<SubjectCommentJobData>);
    }
    if (job.name === AI_JOB_FORM_COMMENT) {
      return this.handleFormComment(job as Job<FormCommentJobData>);
    }
    throw new Error(`unknown job name on ai queue: ${job.name}`);
  }

  private readonly handleSubjectComment = async (job: Job<SubjectCommentJobData>): Promise<void> => {
    const d = job.data;
    if (!d?.schoolId || !d?.studentId || !d?.subjectId || !d?.termId || !d?.classArmId) {
      throw new Error(
        `subject-comment: job ${job.id ?? "(no id)"} missing tenancy/target data; refusing to run`,
      );
    }
    await this.comments.generateForStudent(d);
  };

  private readonly handleFormComment = async (job: Job<FormCommentJobData>): Promise<void> => {
    const d = job.data;
    if (!d?.schoolId || !d?.studentId || !d?.termId || !d?.classArmId || !d?.reportCardId) {
      throw new Error(
        `form-comment: job ${job.id ?? "(no id)"} missing tenancy/target data; refusing to run`,
      );
    }
    await this.formComments.generateForStudent(d);
  };

  // A failed generation leaves the student without a suggestion, which the
  // list endpoint already renders honestly as "no suggestion yet" — there is no
  // status column to write FAILED into, by design (this slice adds no model).
  // So the only thing to do on exhaustion is make it visible in the logs.
  @OnWorkerEvent("failed")
  onFailed(job: Job<SubjectCommentJobData> | undefined, err: Error): void {
    this.logger.error(
      `subject-comment job ${job?.id ?? "(no id)"} failed (attempt ${job?.attemptsMade ?? 0}): ${err.message}`,
    );
  }
}
