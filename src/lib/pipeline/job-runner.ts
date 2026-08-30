import { after } from "next/server";

import { logger } from "@/lib/logger";

/**
 * Runs the pipeline behind an already-sent response, so uploads return a
 * session id immediately instead of holding the request open.
 */
export interface JobRunner {
  enqueue(name: string, job: () => Promise<void>): void;
}

const report = (name: string) => (error: unknown) => {
  logger.error("Background job failed", { job: name, err: error });
};

export class InProcessJobRunner implements JobRunner {
  enqueue(name: string, job: () => Promise<void>): void {
    // Not awaited: the caller is an HTTP handler that must return now. The
    // catch stops a thrown job becoming an unhandled rejection.
    void job().catch(report(name));
  }
}

export class AfterResponseJobRunner implements JobRunner {
  enqueue(name: string, job: () => Promise<void>): void {
    // Serverless freezes the instance once the response is sent, killing
    // unawaited work. after() hands the promise to the platform instead.
    after(job().catch(report(name)));
  }
}

const GLOBAL_KEY = Symbol.for("veda-ai.job-runner");
type GlobalWithRunner = typeof globalThis & { [GLOBAL_KEY]?: JobRunner };

export function getJobRunner(): JobRunner {
  const globalRef = globalThis as GlobalWithRunner;
  // VERCEL is set on every Vercel deployment and never locally.
  globalRef[GLOBAL_KEY] ??= process.env.VERCEL
    ? new AfterResponseJobRunner()
    : new InProcessJobRunner();
  return globalRef[GLOBAL_KEY];
}
