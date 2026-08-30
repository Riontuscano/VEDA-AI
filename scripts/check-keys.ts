/**
 * Verifies every key in the pool before a demo or a deploy.
 *
 *   npm run check:keys
 *
 * Sends one trivial call per key. Prints only the last four characters of each
 * key, never the key itself, so the output is safe to paste anywhere.
 */
import { GoogleGenAI } from "@google/genai";

import { collectApiKeys, getConfig } from "@/lib/config";
import { describeKey } from "@/lib/ai/key-pool";

async function main(): Promise<void> {
  const keys = collectApiKeys(process.env);
  if (keys.length === 0) {
    console.error("No Gemini API keys found. See .env.example.");
    process.exitCode = 1;
    return;
  }

  const model = getConfig().geminiModel;
  console.log(`Pool size: ${keys.length}   Model: ${model}\n`);

  let healthy = 0;

  for (const [index, key] of keys.entries()) {
    const client = new GoogleGenAI({ apiKey: key });
    const label = `key ${String(index + 1).padStart(2)} ${describeKey(key)}`;
    try {
      const response = await client.models.generateContent({
        model,
        contents: "Reply with the single word: ok",
        config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      });
      healthy += 1;
      console.log(`  ${label}  OK    ${JSON.stringify(response.text?.trim().slice(0, 10))}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ${label}  FAIL  ${message.replace(/\s+/g, " ").slice(0, 90)}`);
    }
  }

  console.log(`\n${healthy}/${keys.length} keys healthy.\n`);
  if (healthy === 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
