import { ALL_CODES, jevRequest, readAnswer } from "./lib/logic.js";

// Keys: the options page (chrome.storage) wins; config.local.json is the dev fallback written by sync-keys.ts.
async function getKeys() {
  const { jevKey, nifptKey } = await chrome.storage.local.get(["jevKey", "nifptKey"]);
  if (jevKey || nifptKey) return { jevKey, nifptKey };
  try {
    return await (await fetch(chrome.runtime.getURL("config.local.json"))).json();
  } catch {
    return {};
  }
}

const sha = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------- nif.pt: main CAE + business description, cached forever, queued under the free limits ----------

const NIFPT = { perMinute: 1, perHour: 10 };
let fixtureSeeds = null;

async function cachedNif(nif, fromFixture) {
  if (fromFixture) {
    fixtureSeeds ??= await (await fetch(chrome.runtime.getURL("lib/fixture-nifs.json"))).json();
    return fixtureSeeds[nif] ?? { caes: [], activity: "" };
  }
  return (await chrome.storage.local.get(`nif:${nif}`))[`nif:${nif}`] ?? null;
}

async function enqueueNif(nif) {
  const { nifQueue = [] } = await chrome.storage.local.get("nifQueue");
  if (!nifQueue.includes(nif)) await chrome.storage.local.set({ nifQueue: [...nifQueue, nif] });
  processNifQueue();
}

async function processNifQueue() {
  const { nifQueue = [], nifCalls = [] } = await chrome.storage.local.get(["nifQueue", "nifCalls"]);
  if (!nifQueue.length) return;
  const now = Date.now();
  const recent = nifCalls.filter((t) => now - t < 3600_000);
  if (recent.some((t) => now - t < 60_000 / NIFPT.perMinute) || recent.length >= NIFPT.perHour) return;

  const { nifptKey } = await getKeys();
  if (!nifptKey) return;
  const nif = nifQueue[0];
  await chrome.storage.local.set({ nifCalls: [...recent, now] });
  try {
    const data = await (await fetch(`https://www.nif.pt/?json=1&q=${nif}&key=${nifptKey}`)).json();
    if (data.result !== "success") throw new Error(data.message ?? "nif.pt error");
    const rec = data.records?.[nif];
    const cae = rec?.cae;
    const entry = { caes: (Array.isArray(cae) ? cae : cae ? [cae] : []).map(String), activity: rec?.activity ?? "", fetchedAt: now };
    await chrome.storage.local.set({ [`nif:${nif}`]: entry, nifQueue: nifQueue.slice(1) });
    console.log("✅ nif.pt", nif, entry.caes);
    broadcast({ type: "nif-updated", nif });
  } catch (e) {
    console.log("🔍 nif.pt lookup failed, will retry", nif, e.message);
  }
}

chrome.alarms.create("nifQueue", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => a.name === "nifQueue" && processNifQueue());

async function broadcast(msg) {
  for (const tab of await chrome.tabs.query({})) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
}

// ---------- Jev ----------

async function askJev(body) {
  const key = `jev:${await sha(JSON.stringify(body))}`;
  const hit = (await chrome.storage.local.get(key))[key];
  if (hit) return { ...hit, cached: true };

  const { jevKey } = await getKeys();
  if (!jevKey) throw new Error("No Jev key. Add it on the extension's options page.");
  const base = jevKey.startsWith("sk-or-") ? "https://openrouter.ai/api" : "https://api.typesafe.ai";
  const t0 = performance.now();
  const res = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jevKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    const where = base.includes("openrouter") ? "OpenRouter (openrouter.ai/settings/keys)" : "TypeSafe";
    throw new Error(`Jev key rejected by ${where}: it is wrong, incomplete, deleted or disabled. Paste only the key itself in Settings.`);
  }
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const entry = { answers: (await res.json()).answers, ms: Math.round(performance.now() - t0) };
  await chrome.storage.local.set({ [key]: entry });
  return { ...entry, cached: false };
}

async function decide(inv, fromFixture) {
  const nif = await cachedNif(inv.nif, fromFixture);
  if (!nif) enqueueNif(inv.nif);
  const input = { ...inv, caes: nif?.caes ?? [], activity: nif?.activity ?? "" };
  try {
    const { answers, ms, cached } = await askJev(jevRequest(input, ALL_CODES));
    return { ok: true, ...readAnswer(answers), ms, cached, caeKnown: Boolean(nif) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "decide") {
    decide(msg.invoice, sender.tab?.url?.startsWith("http://localhost:")).then(reply);
    return true;
  }
  if (msg.type === "status") {
    chrome.storage.local.get("nifQueue").then(({ nifQueue = [] }) => getKeys().then((k) => reply({ queued: nifQueue.length, hasJevKey: Boolean(k.jevKey), hasNifptKey: Boolean(k.nifptKey) })));
    return true;
  }
  if (msg.type === "open-options") chrome.runtime.openOptionsPage();
});
