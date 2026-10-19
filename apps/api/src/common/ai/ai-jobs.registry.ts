import { Injectable } from "@nestjs/common";

// The handlers for jobs on AI_QUEUE, by job name. Each AI feature registers
// its own when its service is built; AiJobProcessor (the queue's one worker)
// looks the job up here. This keeps the worker free of every feature module:
// before 2026-10-19 it lived in report-comments and injected all four.

export interface AiJobHandler<T = Record<string, unknown>> {
  /**
   * Fields the job's data must carry, tenancy first (schoolId). A job missing
   * one is refused rather than run against the wrong school or nothing.
   */
  required: readonly (keyof T & string)[];
  run: (data: T) => Promise<unknown>;
}

@Injectable()
export class AiJobRegistry {
  private readonly handlers = new Map<string, AiJobHandler<Record<string, unknown>>>();

  register<T extends object>(name: string, handler: AiJobHandler<T>): void {
    if (this.handlers.has(name)) throw new Error(`AI job "${name}" is registered twice`);
    this.handlers.set(name, handler as unknown as AiJobHandler<Record<string, unknown>>);
  }

  /** Runs the job's handler after checking its data. Throws for an unknown name or missing data. */
  async dispatch(name: string, jobId: string | undefined, data: unknown): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`unknown job name on ai queue: ${name}`);
    const d = (data ?? {}) as Record<string, unknown>;
    const missing = handler.required.filter((k) => d[k] === undefined || d[k] === null || d[k] === "");
    if (missing.length > 0) {
      throw new Error(`${name}: job ${jobId ?? "(no id)"} missing ${missing.join(", ")}; refusing to run`);
    }
    return handler.run(d);
  }

  names(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
