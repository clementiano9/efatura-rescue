import { decide, loadInvoices } from "./jev.ts";

// bun eval.ts                    → mock-page mode (full CAE list filters the options)
// bun eval.ts --hint             → extension mode (main CAE + description only, all 16 categories)
// bun eval.ts --hint --history   → extension mode, then amber rows re-asked with the merchant's settled invoices
const mode = process.argv.includes("--hint") ? "hint" : "full";
const withHistory = process.argv.includes("--history");
const pending = (await loadInvoices()).filter((i: any) => i.status === "P");
const results = await Promise.all(pending.map(async (inv: any) => ({ inv, r: await decide(inv, mode) })));

if (withHistory) {
  for (const row of results) {
    if (row.r.action !== "ask") continue;
    const history = results
      .filter((o) => o !== row && o.inv.nif === row.inv.nif && o.r.action === "auto")
      .map((o) => ({ code: o.r.code, total: o.inv.total, vat: o.inv.vat }));
    if (history.length) row.r = { ...(await decide({ ...row.inv, history }, mode)), withHistory: true };
  }
}

let right = 0, jevRight = 0, jevTotal = 0, wrongAuto = 0;
for (const { inv, r } of results) {
  const ok = r.code === inv.expected;
  right += ok ? 1 : 0;
  if (!ok && r.action === "auto") wrongAuto++;
  if (r.source !== "cae") { jevTotal++; jevRight += ok ? 1 : 0; }
  const detail = r.source === "jev" ? `conf ${r.confidence.toFixed(2)} ${r.ms}ms${r.cached ? " (cached)" : ""}${r.withHistory ? " +history" : ""}` : r.error ?? "";
  console.log(`${ok ? "✅" : "❌"} ${inv.merchant.padEnd(40)} ${r.source.padEnd(4)} ${String(r.code ?? "-").padEnd(4)} want ${inv.expected}  ${r.action.padEnd(4)} ${detail}`);
}
console.log(`\nMode ${mode}${withHistory ? " + history" : ""}. All pending: ${right}/${results.length}. Decided by Jev: ${jevRight}/${jevTotal}. Wrong and filled in without asking: ${wrongAuto}.`);
