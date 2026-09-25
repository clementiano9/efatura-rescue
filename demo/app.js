import { CATEGORIES, allowedCategories, deduction } from "/logic.js";

const $ = (id) => document.getElementById(id);
const eur = (n) => `€${n.toFixed(2)}`;
const cents = (c) => `€${(c / 100).toFixed(2)}`;
const state = new Map(); // id → { inv, result, code, status: "empty"|"auto"|"ask"|"confirmed"|"done" }

const { hasKey, invoices } = await (await fetch("/api/pending")).json();
if (!hasKey) {
  $("banner").style.display = "block";
  $("banner").textContent =
    "No Jev key found. Invoices with a cached Jev answer still work; the rest show 'Needs Jev'. Add TYPESAFE_API_KEY to demo/.env and restart.";
}
$("count").textContent = `${invoices.length} invoices AT could not classify`;

for (const inv of invoices) {
  state.set(inv.idDocumento, { inv, status: "empty", code: "" });
  const tr = document.createElement("tr");
  tr.id = `r${inv.idDocumento}`;
  const opts = allowedCategories(inv._cae).map((c) => `<option value="${c}">${CATEGORIES[c].name}</option>`).join("");
  tr.innerHTML = `
    <td><div class="merchant">${inv.nomeEmitente}</div><div class="sub num">NIF ${inv.nifEmitente}</div><div class="detail"></div></td>
    <td class="hide-sm num">${inv.dataEmissaoDocumento}</td>
    <td class="r num">${cents(inv.valorTotal)}</td>
    <td class="r hide-sm num">${cents(inv.valorIva)}</td>
    <td><select><option value="">— choose —</option>${opts}</select></td>
    <td><button class="submit" disabled>Submit</button></td>`;
  tr.querySelector("select").addEventListener("change", (e) => {
    const s = state.get(inv.idDocumento);
    s.code = e.target.value;
    s.status = s.code ? "confirmed" : "empty";
    paint(inv.idDocumento);
  });
  tr.querySelector(".submit").addEventListener("click", () => {
    state.get(inv.idDocumento).status = "done";
    paint(inv.idDocumento);
  });
  $("rows").append(tr);
}
lucide.createIcons();

function chip(r) {
  if (r.source === "cae") return `<span class="chip"><i data-lucide="list-filter"></i>Only option for this merchant's activity</span>`;
  if (r.source === "none") return `<span class="chip warn"><i data-lucide="key-round"></i>Needs Jev</span>`;
  const pct = Math.round(r.confidence * 100);
  if (r.action === "auto") return `<span class="chip jev"><i data-lucide="check"></i>Jev · ${pct}% confidence · ${r.ms} ms</span>`;
  const [, second] = Object.entries(r.probabilities).sort((a, b) => b[1] - a[1]);
  const alt = second ? ` · could be ${CATEGORIES[second[0]].name} (${Math.round(second[1] * 100)}%)` : "";
  return `<span class="chip warn"><i data-lucide="scan-line"></i>Check your receipt · ${pct}% confidence${alt}</span>`;
}

function paint(id) {
  const s = state.get(id);
  const tr = $(`r${id}`);
  const select = tr.querySelector("select");
  const btn = tr.querySelector(".submit");
  select.value = s.code;
  tr.className = { auto: "auto", ask: "ask", done: "done", confirmed: "auto" }[s.status] ?? "";
  btn.disabled = !s.code || s.status === "done";
  btn.textContent = s.status === "done" ? "Submitted" : s.status === "ask" ? "Confirm & submit" : "Submit";
  if (s.result) {
    const reason = s.code ? CATEGORIES[s.code].reason : "";
    tr.querySelector(".detail").innerHTML = `${reason ? `<div class="reason">${reason}</div>` : ""}${chip(s.result)}`;
    lucide.createIcons();
  }
  totals();
}

function totals() {
  const all = [...state.values()];
  const count = (st) => all.filter((s) => st.includes(s.status));
  const ready = deduction(count(["auto", "confirmed", "done"]).map((s) => ({ inv: s.inv, code: s.code })));
  const everything = deduction(all.filter((s) => s.code).map((s) => ({ inv: s.inv, code: s.code })));
  $("m-total").textContent = eur(everything);
  $("m-ready").textContent = eur(ready);
  $("m-wait").textContent = eur(everything - ready);
  if (all.some((s) => s.result)) {
    $("s-auto").textContent = count(["auto", "confirmed", "done"]).length;
    $("s-ask").textContent = count(["ask", "empty"]).length;
  }
}

$("go").addEventListener("click", async () => {
  $("go").disabled = true;
  $("go").querySelector("span").textContent = "Sorting…";
  const t0 = performance.now();
  const results = await Promise.all(
    invoices.map(async (inv) => {
      const r = await (await fetch(`/api/decide/${inv.idDocumento}`)).json();
      const s = state.get(inv.idDocumento);
      s.result = r;
      s.code = r.code ?? "";
      s.status = r.source === "none" ? "empty" : r.action;
      paint(inv.idDocumento);
      const tr = $(`r${inv.idDocumento}`);
      tr.classList.add("fresh");
      return r;
    }),
  );
  // Replayed answers return instantly, so report the slowest recorded Jev call (calls run in parallel).
  const cached = results.some((r) => r.cached);
  const slowestJev = Math.max(0, ...results.map((r) => r.ms ?? 0));
  $("s-ms").textContent = ((cached ? slowestJev : performance.now() - t0) / 1000).toFixed(2);
  $("s-ms-label").textContent = cached ? "sec (recorded)" : "seconds";
  $("go").querySelector("span").textContent = "Sorted";
});
