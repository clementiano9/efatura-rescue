import { allowedCategories, buildQuestions, buildState, gate } from "./logic.js";

const DIR = import.meta.dir;
const CACHE_PATH = `${DIR}/jev-cache.json`;
const KEY = process.env.TYPESAFE_API_KEY;
// OpenRouter serves the same /v1/systemone shape under its own base URL.
const BASE_URL = process.env.TYPESAFE_BASE_URL ?? (KEY?.startsWith("sk-or-") ? "https://openrouter.ai/api" : "https://api.typesafe.ai");

export const hasKey = Boolean(KEY);

export async function loadInvoices() {
  const data = await Bun.file(`${DIR}/../sample-data/efatura_adquirente.json`).json();
  return data.linhas;
}

let cache: Record<string, any> = (await Bun.file(CACHE_PATH).exists()) ? await Bun.file(CACHE_PATH).json() : {};

// Cache key includes the request body, so editing a criteria sentence forces a fresh Jev call.
async function askJev(body: object) {
  const key = Bun.hash(JSON.stringify(body)).toString(36);
  if (cache[key]) return { ...cache[key], cached: true };
  if (!KEY) throw new Error("TYPESAFE_API_KEY is not set and this invoice has no cached answer");

  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${await res.text()}`);
  const entry = { answers: (await res.json()).answers, ms: Math.round(performance.now() - t0) };
  cache[key] = entry;
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
  return { ...entry, cached: false };
}

export async function decide(inv: any) {
  const allowed = allowedCategories(inv._cae);
  const base = { id: inv.idDocumento, allowed };
  if (allowed.length === 1) return { ...base, source: "cae", code: allowed[0], confidence: 1, action: "auto" };

  try {
    const { answers, ms, cached } = await askJev({ state: buildState(inv), model: "jev-latest", questions: buildQuestions(allowed) });
    const r = {
      code: answers.category.choice,
      probabilities: answers.category.probabilities,
      confidence: answers.category.confidence,
    };
    return { ...base, source: "jev", ms, cached, ...r, action: gate(r) };
  } catch (e) {
    return { ...base, source: "none", error: (e as Error).message, action: "ask" };
  }
}
