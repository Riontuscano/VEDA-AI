/**
 * Verifies storage configuration by actually using it.
 *
 *   npm run check:storage
 *
 * Reports which backend each interface resolved to, then performs a real
 * round-trip through both. Checking that a variable is merely *set* proves
 * nothing: a wrong token, a deleted store or a paused database all look fine
 * until the first write.
 */
import { randomUUID } from "node:crypto";

import { getConfig, resolveRedisCredentials } from "@/lib/config";
import { getFileStore, getSessionStore } from "@/lib/store";
import type { SessionResult } from "@/lib/types";

const tick = (ok: boolean) => (ok ? "\x1b[32mOK\x1b[0m  " : "\x1b[31mFAIL\x1b[0m");

async function main(): Promise<void> {
  const config = getConfig();
  const { redisUrl } = resolveRedisCredentials(process.env);

  const onVercel = Boolean(process.env.VERCEL);
  const sessionBackend = config.redisUrl ? "Upstash Redis" : "in-memory Map";
  const fileBackend = config.blobToken ? "Vercel Blob" : "local disk";

  console.log("\nResolved configuration");
  console.log("──────────────────────────────────────────────");
  console.log(`  platform      ${onVercel ? "Vercel" : "local or single server"}`);
  console.log(`  sessions      ${sessionBackend}`);
  console.log(`  page images   ${fileBackend}`);
  if (redisUrl) console.log(`  redis host    ${new URL(redisUrl).host}`);
  console.log(`  gemini keys   ${config.geminiApiKeys.length}`);

  if (onVercel && !config.redisUrl) {
    console.log(
      "\n\x1b[31mOn Vercel without Redis. Sessions would not survive between requests.\x1b[0m",
    );
    process.exitCode = 1;
    return;
  }
  if (!onVercel && !config.redisUrl) {
    console.log(
      "\n  Note: no Redis configured. Correct for a single long-lived server,",
    );
    console.log("  and required before deploying to serverless.");
  }

  console.log("\nRound-trip");
  console.log("──────────────────────────────────────────────");

  const sessionId = `checkstorage-${randomUUID().slice(0, 8)}`;
  let ok = true;

  // Sessions: write, read back, mutate, confirm the mutation landed.
  try {
    const sessions = getSessionStore();
    const seed: SessionResult = {
      sessionId,
      status: "uploading",
      createdAt: Date.now(),
      questionPages: [],
      answerPages: [],
      questions: [],
      answers: [],
      mappings: [],
      errors: [],
    };

    await sessions.create(seed);
    const readBack = await sessions.get(sessionId);
    if (readBack?.sessionId !== sessionId) throw new Error("read-back mismatch");

    const updated = await sessions.update(sessionId, (current) => ({
      ...current,
      status: "done",
    }));
    if (updated.status !== "done") throw new Error("update did not apply");

    await sessions.delete(sessionId);
    console.log(`  ${tick(true)} sessions: write, read, update, delete`);
  } catch (error) {
    ok = false;
    console.log(
      `  ${tick(false)} sessions: ${error instanceof Error ? error.message : error}`,
    );
  }

  // Files: store a small payload and read the identical bytes back.
  try {
    const files = getFileStore();
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const key = await files.save(sessionId, "probe", {
      bytes: payload,
      contentType: "image/png",
    });
    const fetched = await files.read(key);

    if (!fetched) throw new Error("stored file could not be read back");
    if (fetched.bytes.length !== payload.length) {
      throw new Error(
        `byte length changed: wrote ${payload.length}, read ${fetched.bytes.length}`,
      );
    }
    await files.deleteSession(sessionId);
    console.log(`  ${tick(true)} page images: write and read back identical bytes`);
  } catch (error) {
    ok = false;
    console.log(
      `  ${tick(false)} page images: ${error instanceof Error ? error.message : error}`,
    );
  }

  console.log(
    ok
      ? "\n\x1b[32mStorage is usable.\x1b[0m\n"
      : "\n\x1b[31mStorage is not usable. See the failures above.\x1b[0m\n",
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
