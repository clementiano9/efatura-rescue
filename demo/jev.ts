import { ALL_CODES, allowedCategories, fromPortalLines, jevRequest, readAnswer } from "../extension/lib/logic.js";

const DIR = import.meta.dir;
const CACHE_PATH = `${DIR}/jev-cache.json`;
const KEY = process.env.TYPESAFE_API_KEY;
// OpenRouter serves the same /v1/systemone shape under its own base URL.
const BASE_URL = process.env.TYPESAFE_BASE_URL ?? (KEY?.startsWith("sk-or-") ? "https://openrouter.ai/api" : "https://api.typesafe.ai");

export const hasKey = Boolean(KEY);

const seeds = await Bun.file(`${DIR}/../extension/lib/fixture-nifs.json`).json();

// Sample data → the shared invoice shape, plus the fields only the demo and eval use.
function fromSample(s: any) {
  return {
    id: s.idDocumento,
    nif: String(s.nifEmitente),
    merchant: s.nomeEmitente,
    docType: s.tipoDocumento,
    number: s.numeroDocumento,
    date: s.dataEmissaoDocumento,
    status: s.estadoDocumento,
    total: s.valorTotal,
    vat: s.valorIva,
    lines: fromPortalLines(s.linhas),
    rawLines: s.linhas,
    fullCaes: s._cae,
    expected: s._expected.codigo,
  };
}

export async function loadInvoices() {
  const data = await Bun.file(`${DIR}/../sample-data/efatura_adquirente.json`).json();
  return data.linhas.map(fromSample);
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

// "full": the sample's complete CAE list filters the options (the mock demo).
// "hint": only the main CAE + description, as nif.pt returns them, and every category offered (the extension).
export async function decide(inv: any, mode: "full" | "hint" = "full") {
  const seed = seeds[inv.nif];
  const input = mode === "full" ? { ...inv, caes: inv.fullCaes } : { ...inv, caes: seed?.caes ?? [], activity: seed?.activity };
  const allowed = mode === "full" ? allowedCategories(inv.fullCaes) : ALL_CODES;
  const base = { id: inv.id, allowed };
  if (allowed.length === 1) return { ...base, source: "cae", code: allowed[0], confidence: 1, action: "auto" };

  try {
    const { answers, ms, cached } = await askJev(jevRequest(input, allowed));
    return { ...base, source: "jev", ms, cached, ...readAnswer(answers) };
  } catch (e) {
    return { ...base, source: "none", error: (e as Error).message, action: "ask" };
  }
}
