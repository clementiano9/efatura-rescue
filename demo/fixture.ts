// A stand-in for the portal's resolve page and detail pages, built from the sample invoices.
// Row, button and data attributes copy the real page (see EXTENSION_PLAN.md); the styling does not.
import { CATEGORIES } from "../extension/lib/logic.js";

const BUTTON_ROWS = [["C05", "C11", "C06", "C07", "C08", "C99"], ["C01", "C02", "C03", "C04", "C09"], ["C10", "C12", "C13", "C14", "C15"]];
const ptEuro = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const buttons = () =>
  BUTTON_ROWS.map((row) =>
    row.map((c) => `<button type="button" class="btn showTooltip" data-original-title="${esc(CATEGORIES[c].title)}" value="${c}"><span class="iconListagem">${CATEGORIES[c].name}</span></button>`).join("\n"),
  ).join('\n<p style="margin: 5px;"></p>\n');

export function resolvePage(invoices: any[], lengths = [10, 20, 50]) {
  const rows = invoices
    .map(
      (inv, i) => `<tr class="${i % 2 ? "even" : "odd"}" id="documento_${inv.id}">
<td class="leftText sorting_1">${inv.nif} - ${esc(inv.merchant)}</td>
<td class="leftText">${esc(inv.number)}</td>
<td class="centerText nowrap_text">${inv.date}</td>
<td class="rightText nowrap_text ">${ptEuro(inv.vat)}</td>
<td class="rightText nowrap_text">${ptEuro(inv.total)}</td>
<td class="centerText"><div class="btn-group selecaoSector radioBtnSelectPendencia" data-toggle="buttons-radio">
${buttons()}
</div></td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><title>Faturas pendentes (mock)</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/2.3.2/css/bootstrap.min.css">
<style>
  body { padding: 20px; background: #f5f5f5; }
  .mockbar { background: #fff3cd; border: 1px solid #e6d28a; padding: 6px 12px; margin-bottom: 12px; border-radius: 4px; }
  .selecaoSector .btn { font-size: 11px; padding: 2px 6px; margin: 1px; }
  .selecaoSector .btn.active { background: #1f5f4a; color: #fff; }
  #listaPendencias { background: #fff; }
</style></head>
<body>
<div class="mockbar">Mock of e-Fatura's "resolver pendências" page, built from sample data. Not the real portal.</div>
<h3>Faturas pendentes</h3>
<table class="table table-striped table-bordered table-hover dataTable" id="listaPendencias">
<thead><tr role="row"><th>Emitente</th><th>N.º Fatura</th><th>Data Emissão</th><th>IVA</th><th>Valor Total</th><th>Atividade de Realização da Aquisição</th></tr></thead>
<tbody aria-live="polite" aria-relevant="all">
${rows}
</tbody></table>
<div id="modalPendencias" class="modal hide fade" style="display:none">
  <div class="modal-header"><h3>Aviso</h3></div>
  <div class="modal-body"><p id="textConfirmModalPendencias"></p></div>
  <div class="modal-footer"><button id="allBtn" class="btn btn-success" type="button">Todas</button><button id="oneBtn" class="btn" type="button">Só esta</button></div>
</div>
<button id="guardarResolverListaPendenciasBtn" class="btn btn-primary" type="button">Submeter</button>
<span id="mockResult" style="margin-left:12px"></span>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/1.12.4/jquery.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/datatables/1.9.4/jquery.dataTables.min.js"></script>
<script>
  // Same library family and page size as the portal (DataTables 1.9, 10 rows, "Total: N").
  const dt = window.jQuery && jQuery("#listaPendencias").dataTable({
    iDisplayLength: ${lengths[0]},
    aLengthMenu: ${JSON.stringify(lengths)},
    oLanguage: { sInfo: "Total: _TOTAL_", sLengthMenu: "_MENU_ registos por página" },
  });
  const allRows = () => (dt ? [...dt.fnGetNodes()] : [...document.querySelectorAll("#listaPendencias tbody tr")]);
  // One .active per row (Bootstrap 2 buttons-radio). Like the portal: picking a sector on a row whose NIF has other rows on the page asks "All" or "Only this".
  const nifOf = (tr) => tr.cells[0].textContent.split(" - ")[0].trim();
  const pick = (tr, code) => tr.querySelectorAll(".selecaoSector button").forEach((x) => x.classList.toggle("active", x.value === code));
  const modal = document.getElementById("modalPendencias");
  let pending = null;
  const hideModal = () => { modal.style.display = "none"; modal.classList.remove("in"); document.querySelector(".modal-backdrop")?.remove(); pending = null; };
  allRows().forEach((tr) => {
    tr.querySelector(".selecaoSector").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      pick(tr, b.value);
      const others = [...document.querySelectorAll("#listaPendencias tbody tr")].filter((o) => o !== tr && nifOf(o) === nifOf(tr));
      if (!others.length) return;
      pending = { others, code: b.value };
      document.getElementById("textConfirmModalPendencias").textContent = "Pretende atribuir o mesmo setor (" + b.dataset.originalTitle + ") às faturas da página com o NIF " + nifOf(tr) + "?";
      document.body.insertAdjacentHTML("beforeend", '<div class="modal-backdrop fade in"></div>');
      modal.style.display = "block";
      modal.classList.add("in");
    });
  });
  document.getElementById("allBtn").addEventListener("click", () => { pending?.others.forEach((o) => pick(o, pending.code)); hideModal(); });
  document.getElementById("oneBtn").addEventListener("click", hideModal);
  // Counts picks on every list page, which is what we assume the real Submeter does (unverified).
  document.getElementById("guardarResolverListaPendenciasBtn").addEventListener("click", () => {
    const picked = allRows().filter((tr) => tr.querySelector("button.active"));
    picked.forEach((tr) => (dt ? dt.fnDeleteRow(tr) : tr.remove()));
    document.getElementById("mockResult").textContent = picked.length + " invoice(s) submitted (mock).";
  });
</script>
</body></html>`;
}

export function detailPage(inv: any) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Detalhe (mock)</title></head><body>
<p>${esc(inv.merchant)} · ${esc(inv.number)}</p>
<script>
var dadosLinhasDocumento = ${JSON.stringify(inv.rawLines)};
Opensoft.init && Opensoft.init();
</script></body></html>`;
}
