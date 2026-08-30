import { after } from "next/server";

import { logger } from "@/lib/logger";

/**
 * Background job seam.
 *
 * Uploads return a session id immediately and the pipeline runs behind it, so
 * the client polls for progress instead of holding a request open through a
 * minute of model calls.
 *
 * Two implementations, because the two deployment targets have genuinely
 * different execution models:
 *
 *   InProcessJobRunner  a long-lived server. Fire and forget is correct; the
 *                       process outlives the response.
 *   AfterResponseRunner serverless. The instance is frozen once the response is
 *                       sent, so unawaited work is simply killed. `after()`
 *                       hands the promise to the platform, which keeps the
 *                       invocation alive until it settles.
 */
export interface JobRunner {
  enqueue(name: string, job: () => Promise<void>): void;
}

const report = (name: string) => (error: unknown) => {
  logger.error("Background job failed", { job: name, err: error });
};

export class InProcessJobRunner implements JobRunner {
  enqueue(name: string, job: () => Promise<void>): void {
    // Deliberately not awaited: the caller is an HTTP handler that must return
    // now. The catch is what keeps a thrown job from becoming an unhandled
    // rejection that takes the process down.
    void job().catch(report(name));
  }
}

export class AfterResponseJobRunner implements JobRunner {
  enqueue(name: string, job: () => Promise<void>): void {
    after(job().catch(report(name)));
  }
}

const GLOBAL_KEY = Symbol.for("veda-ai.job-runner");
type GlobalWithRunner = typeof globalThis & { [GLOBAL_KEY]?: JobRunner };

/**
 * Picks the runner from the platform.
 *
 * `VERCEL` is set by Vercel on every deployment and never locally, which makes
 * it a reliable signal for "this process will be frozen after the response".
 */
export function getJobRunner(): JobRunner {
  const globalRef = globalThis as GlobalWithRunner;
  globalRef[GLOBAL_KEY] ??= process.env.VERCEL
    ? new AfterResponseJobRunner()
    : new InProcessJobRunner();
  return globalRef[GLOBAL_KEY];
}
