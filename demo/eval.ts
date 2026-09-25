import { decide, loadInvoices } from "./jev.ts";

const pending = (await loadInvoices()).filter((i: any) => i.estadoDocumento === "P");
const results = await Promise.all(pending.map(async (inv: any) => ({ inv, r: await decide(inv) })));

let right = 0, jevRight = 0, jevTotal = 0;
for (const { inv, r } of results) {
  const ok = r.code === inv._expected.codigo;
  right += ok ? 1 : 0;
  if (r.source !== "cae") { jevTotal++; jevRight += ok ? 1 : 0; }
  const detail = r.source === "jev"
    ? `conf ${r.confidence.toFixed(2)} ${r.ms}ms${r.cached ? " (cached)" : ""}`
    : r.error ?? "";
  console.log(`${ok ? "✅" : "❌"} ${inv.nomeEmitente.padEnd(40)} ${r.source.padEnd(4)} ${String(r.code ?? "-").padEnd(4)} want ${inv._expected.codigo}  ${r.action.padEnd(4)} ${detail}`);
}
console.log(`\nAll pending: ${right}/${results.length}. Jev-only (CAE table left more than one option): ${jevRight}/${jevTotal}.`);
