import { decide, loadInvoices } from "./jev.ts";

// bun eval.ts         → mock-demo mode (full CAE list filters the options)
// bun eval.ts --hint  → extension mode (main CAE + description only, all 16 categories)
const mode = process.argv.includes("--hint") ? "hint" : "full";
const pending = (await loadInvoices()).filter((i: any) => i.status === "P");
const results = await Promise.all(pending.map(async (inv: any) => ({ inv, r: await decide(inv, mode) })));

let right = 0, jevRight = 0, jevTotal = 0;
for (const { inv, r } of results) {
  const ok = r.code === inv.expected;
  right += ok ? 1 : 0;
  if (r.source !== "cae") { jevTotal++; jevRight += ok ? 1 : 0; }
  const detail = r.source === "jev" ? `conf ${r.confidence.toFixed(2)} ${r.ms}ms${r.cached ? " (cached)" : ""}` : r.error ?? "";
  console.log(`${ok ? "✅" : "❌"} ${inv.merchant.padEnd(40)} ${r.source.padEnd(4)} ${String(r.code ?? "-").padEnd(4)} want ${inv.expected}  ${r.action.padEnd(4)} ${detail}`);
}
console.log(`\nMode ${mode}. All pending: ${right}/${results.length}. Decided by Jev: ${jevRight}/${jevTotal}.`);
