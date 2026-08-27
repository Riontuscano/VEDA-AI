import { logger } from "@/lib/logger";

/**
 * Background job seam.
 *
 * Uploads return a session id immediately and the pipeline runs behind it, so
 * the client can poll for progress instead of holding a request open through
 * a minute of model calls.
 *
 * The shipped implementation runs jobs in the same process, which is correct
 * because the app is deployed as a single long-lived Node server. Moving to a
 * real queue means implementing this interface, not touching pipeline code.
 */
export interface JobRunner {
  enqueue(name: string, job: () => Promise<void>): void;
}

export class InProcessJobRunner implements JobRunner {
  enqueue(name: string, job: () => Promise<void>): void {
    // Deliberately not awaited: the caller is an HTTP handler that must return
    // now. The catch is what keeps a thrown job from becoming an unhandled
    // rejection that takes the process down.
    void job().catch((error: unknown) => {
      logger.error("Background job failed", { job: name, err: error });
    });
  }
}

const GLOBAL_KEY = Symbol.for("veda-ai.job-runner");
type GlobalWithRunner = typeof globalThis & { [GLOBAL_KEY]?: JobRunner };

export function getJobRunner(): JobRunner {
  const globalRef = globalThis as GlobalWithRunner;
  globalRef[GLOBAL_KEY] ??= new InProcessJobRunner();
  return globalRef[GLOBAL_KEY];
}
