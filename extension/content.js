// Runs on e-Fatura's "resolver pendências" page (and the localhost mock of it).
// Reads each pending row, fetches its VAT lines, asks the background worker for a Jev decision,
// clicks the category button when Jev is confident, and leaves Submeter to the user.
(async () => {
  const L = await import(chrome.runtime.getURL("lib/logic.js"));
  const table = await waitFor("#listaPendencias");
  const entries = new Map(); // idDocumento → { inv, decision, status, code, note }
  let started = false;

  injectStyles();
  const panel = buildPanel();

  function waitFor(sel) {
    return new Promise((resolve) => {
      const el = document.querySelector(sel);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(sel);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // ---------- Reading the page ----------

  function readRow(tr) {
    const id = tr.id?.match(/^documento_(\d+)$/)?.[1];
    if (!id || tr.cells.length < 6) return null;
    const text = (i) => tr.cells[i].textContent.replace(/\s+/g, " ").trim();
    const [nif, ...name] = text(0).split(" - ");
    const number = text(1);
    return {
      id, nif: nif.trim(), merchant: name.join(" - "), number, docType: number.split(" ")[0],
      date: text(2), vat: L.parseEuro(text(3)), total: L.parseEuro(text(4)), lines: null,
    };
  }

  // The detail page assigns the VAT lines to a JS array; match brackets rather than trusting what follows it.
  function extractArray(html, name) {
    const at = html.indexOf(name);
    if (at < 0) return null;
    const start = html.indexOf("[", at);
    let depth = 0, inStr = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
    return null;
  }

  async function fetchLines(inv) {
    try {
      const url = new URL(`detalheDocumentoAdquirente.action?idDocumento=${inv.id}&dataEmissaoDocumento=${inv.date}`, location.href);
      const linhas = extractArray(await (await fetch(url, { credentials: "include" })).text(), "dadosLinhasDocumento");
      return linhas ? L.fromPortalLines(linhas) : null;
    } catch (e) {
      console.log("🔍 detail page failed", inv.id, e.message);
      return null;
    }
  }

  // ---------- Deciding and applying ----------

  // History is only sent on re-asks, so a first decision never depends on which rows happened to finish first.
  async function process(id, useHistory = false) {
    const e = entries.get(id);
    const preset = document.getElementById(`documento_${id}`)?.querySelector(".selecaoSector button.active");
    if (preset) return Object.assign(e, { status: "user", code: preset.value }), paintRow(id), paintPanel();
    const history = useHistory ? settledHistory(e) : [];
    e.status = "deciding";
    paintRow(id);
    e.inv.lines ??= await fetchLines(e.inv);
    e.historyCount = history.length;
    const d = await chrome.runtime.sendMessage({ type: "decide", invoice: { ...e.inv, history } });
    e.decision = d;
    if (!d.ok) { e.status = "error"; e.note = d.error; }
    else if (e.status !== "user") { e.code = d.code; e.status = d.action === "auto" ? "apply" : "ask"; }
    if (e.status === "apply") click(id, e.code);
    paintRow(id);
    paintPanel();
  }

  // Fails closed: no click unless the button's label is the one this code should have.
  function click(id, code) {
    const e = entries.get(id);
    const tr = document.getElementById(`documento_${id}`);
    if (!tr) return; // on another list page; applied when it renders
    const active = tr.querySelector(".selecaoSector button.active");
    if (active && active.value !== code) { e.status = "user"; e.code = active.value; return; }
    const btn = tr.querySelector(`.selecaoSector button[value="${code}"]`);
    if (!btn || btn.dataset.originalTitle?.trim() !== L.CATEGORIES[code]?.title) {
      e.status = "mismatch";
      e.note = `Button for ${code} not found or relabelled; not clicked.`;
      return;
    }
    if (!active) queueClick(btn);
    e.status = "applied";
  }

  // Picking a sector for one invoice makes the portal ask whether to give the merchant's other invoices on the
  // page the same sector. Jev decides each invoice separately, so our clicks run one at a time and answer
  // "Only this". A modal the user triggers is left for the user.
  let clickChain = Promise.resolve();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function queueClick(btn) {
    clickChain = clickChain.then(async () => {
      btn.click();
      await answerSameSectorModal();
    });
  }

  function sameSectorModal() {
    const m = document.querySelector("#modalPendencias") ?? document.querySelector("#allBtn")?.closest(".modal");
    return m && (m.classList.contains("in") || getComputedStyle(m).display === "block") ? m : null;
  }

  async function answerSameSectorModal() {
    let m = sameSectorModal();
    if (!m) { await sleep(60); m = sameSectorModal(); }
    if (!m) return;
    // #oneBtn is "Só esta" on the real portal; otherwise accept the footer's only non-"All" button.
    const others = [...m.querySelectorAll(".modal-footer button, .modal-footer a.btn")].filter((b) => b.id !== "allBtn");
    const onlyThis = m.querySelector("#oneBtn") ?? (others.length === 1 ? others[0] : null);
    if (!onlyThis) {
      console.log("🔍 same-sector modal has an unexpected layout; leaving it for the user");
      return;
    }
    onlyThis.click();
    for (let i = 0; i < 40 && sameSectorModal(); i++) await sleep(50);
    if (!sameSectorModal()) document.querySelectorAll(".modal-backdrop").forEach((b) => b.remove());
  }

  async function run(ids, limit = 4, useHistory = false) {
    const queue = [...ids];
    await Promise.all(Array.from({ length: limit }, async () => {
      while (queue.length) await process(queue.shift(), useHistory);
    }));
    // Second pass: an amber row is asked again once more of its merchant's invoices are settled.
    // Confident rows are left alone: the same shop can sell a meal and a loaf of bread.
    const again = [...entries.values()].filter((e) => e.status === "ask" && settledHistory(e).length > (e.historyCount ?? 0));
    if (again.length) await run(again.map((e) => e.inv.id), limit, true);
  }

  function settledHistory(e) {
    return [...entries.values()]
      .filter((o) => o !== e && o.inv.nif === e.inv.nif && (o.status === "applied" || o.status === "user"))
      .map((o) => ({ code: o.code, total: o.inv.total, vat: o.inv.vat }));
  }

  function scanRows() {
    const fresh = [];
    for (const tr of table.tBodies[0]?.rows ?? []) {
      const inv = readRow(tr);
      if (!inv) continue;
      if (!entries.has(inv.id)) { entries.set(inv.id, { inv, status: "new" }); fresh.push(inv.id); }
      else if (entries.get(inv.id).status === "apply") click(inv.id, entries.get(inv.id).code);
      paintRow(inv.id);
    }
    return fresh;
  }

  // Show every row the list allows (max 50 a page) so one pass covers as much as possible.
  function showAllRows() {
    const sel = document.querySelector('select[name="listaPendencias_length"]');
    const max = sel && [...sel.options].map((o) => o.value).sort((a, b) => b - a)[0];
    if (sel && sel.value !== max) {
      sel.value = max;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async function sort() {
    started = true;
    panel.go.disabled = true;
    panel.go.textContent = "Sorting…";
    showAllRows();
    await run(scanRows());
    panel.go.textContent = "Sorted";
    paintPanel();
  }

  // Only row insertions (DataTables redraws); our own notes and clicks change cells, not the tbody's children.
  new MutationObserver(() => started && run(scanRows())).observe(table.tBodies[0], { childList: true });

  // A click the user makes themselves always wins over ours.
  table.addEventListener("click", (ev) => {
    const btn = ev.target.closest?.(".selecaoSector button");
    const id = btn?.closest("tr")?.id?.match(/^documento_(\d+)$/)?.[1];
    if (!ev.isTrusted || !id || !entries.has(id) || ev.target.closest(".efr-apply")) return;
    Object.assign(entries.get(id), { status: "user", code: btn.value });
    paintRow(id);
    paintPanel();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "nif-updated") return;
    const redo = [...entries.values()].filter((e) => e.inv.nif === msg.nif && e.status === "ask").map((e) => e.inv.id);
    run(redo);
  });

  // ---------- Drawing ----------

  function paintRow(id) {
    const e = entries.get(id);
    const tr = document.getElementById(`documento_${id}`);
    if (!tr) return;
    tr.classList.remove("efr-auto", "efr-ask", "efr-busy");
    tr.querySelector(".efr-note")?.remove();
    const d = e.decision;
    const name = e.code ? L.CATEGORIES[e.code]?.name : "";
    const pct = d?.ok ? Math.round(d.confidence * 100) : 0;
    let html = "";
    if (e.status === "deciding") { tr.classList.add("efr-busy"); html = "Jev is deciding…"; }
    else if (e.status === "applied") { tr.classList.add("efr-auto"); html = `<b>${name}</b> · Jev ${pct}%<br>${L.CATEGORIES[e.code].reason}`; }
    else if (e.status === "user") { tr.classList.add("efr-auto"); html = `<b>${name}</b> · your choice`; }
    else if (e.status === "ask") {
      tr.classList.add("efr-ask");
      const [, second] = Object.entries(d.probabilities).sort((a, b) => b[1] - a[1]);
      const alt = second ? `, or ${L.CATEGORIES[second[0]].name} ${Math.round(second[1] * 100)}%` : "";
      const wait = d.caeKnown ? "" : " Merchant lookup pending; Jev will retry.";
      html = `<b>Check your receipt.</b> Best guess ${name} ${pct}%${alt}.${wait} <button type="button" class="efr-apply">Use ${name}</button>`;
    } else if (e.status === "mismatch" || e.status === "error") { tr.classList.add("efr-ask"); html = e.note; }
    if (!html) return;
    const div = document.createElement("div");
    div.className = "efr-note";
    div.innerHTML = html;
    div.querySelector(".efr-apply")?.addEventListener("click", () => { click(id, e.code); paintRow(id); paintPanel(); });
    tr.cells[0].append(div);
  }

  function paintPanel() {
    const all = [...entries.values()];
    const is = (...s) => all.filter((e) => s.includes(e.status));
    const done = is("applied", "user");
    const asks = is("ask", "mismatch", "error");
    const ready = L.deduction(done.map((e) => ({ inv: e.inv, code: e.code })));
    const waiting = L.deduction([...done, ...is("ask")].map((e) => ({ inv: e.inv, code: e.code }))) - ready;
    const total = Number(document.querySelector("#listaPendencias_info")?.textContent.match(/\d+/)?.[0] ?? all.length);
    panel.stats.innerHTML = `
      <div><b>${done.length}</b><span>filled in</span></div>
      <div><b>${asks.length}</b><span>need you</span></div>
      <div><b>${all.length}/${total}</b><span>seen</span></div>`;
    panel.money.innerHTML = `<b>€${ready.toFixed(2)}</b> ready to submit${waiting > 0 ? ` · €${waiting.toFixed(2)} waiting on you` : ""}`;
    chrome.runtime.sendMessage({ type: "status" }).then((s) => {
      const bits = [];
      if (!s.hasJevKey) bits.push("No Jev key: open Settings.");
      if (!s.hasNifptKey) bits.push("No nif.pt key: merchants' activities stay unknown.");
      if (s.queued) bits.push(`Looking up ${s.queued} merchant(s) on nif.pt (10 an hour).`);
      if (total > all.length && started) bits.push("More pending invoices on the next list pages: open them and they'll be sorted too.");
      panel.status.textContent = bits.join(" ");
    });
  }

  function buildPanel() {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .p { width: 300px; font: 13px/1.4 system-ui, sans-serif; color: #1d1f22; background: #fff; border: 1px solid #d9d5cc; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.12); padding: 14px; }
      h3 { margin: 0 0 2px; font-size: 14px; } p { margin: 0; color: #6b6f76; }
      .go { width: 100%; margin: 10px 0; padding: 9px; font: inherit; font-weight: 600; color: #fff; background: #1f5f4a; border: 0; border-radius: 7px; cursor: pointer; }
      .go:disabled { opacity: .65; cursor: default; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .stats div { background: #f4f2ee; border-radius: 6px; padding: 6px; } .stats b { display: block; font-size: 16px; } .stats span { color: #6b6f76; font-size: 11px; }
      .money { margin-top: 8px; } .money b { color: #1f5f4a; font-size: 16px; }
      .status { margin-top: 6px; font-size: 12px; color: #9a5b00; } a { color: #1f5f4a; font-size: 12px; cursor: pointer; }
      .head { display: flex; justify-content: space-between; align-items: center; }
      .min { border: 0; background: none; font-size: 16px; cursor: pointer; color: #6b6f76; }
      .p.small .body { display: none; } .p.small { width: auto; }
    </style>
    <div class="p">
      <div class="head"><h3>e-Fatura Rescue</h3><button class="min" title="Collapse">–</button></div>
      <div class="body">
      <p>Jev sorts each pending invoice. Confident ones are filled in; you check the rest and press Submeter.</p>
      <button class="go">Sort pending invoices</button>
      <div class="stats"></div><div class="money"></div><div class="status"></div>
      <a class="settings">Settings</a>
      </div>
    </div>`;
    document.body.append(host);
    const $ = (s) => root.querySelector(s);
    $(".go").addEventListener("click", sort);
    $(".settings").addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-options" }));
    $(".min").addEventListener("click", () => {
      const small = $(".p").classList.toggle("small");
      $(".min").textContent = small ? "+" : "–";
    });
    return { go: $(".go"), stats: $(".stats"), money: $(".money"), status: $(".status") };
  }

  function injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      #listaPendencias tr.efr-auto > td { background: #e3efe9 !important; }
      #listaPendencias tr.efr-ask > td { background: #fbf0dc !important; }
      #listaPendencias tr.efr-busy > td { opacity: .6; }
      .efr-note { margin-top: 4px; font-size: 12px; line-height: 1.35; color: #333; max-width: 40ch; }
      .efr-apply { margin-left: 4px; font-size: 11px; padding: 1px 6px; border: 1px solid #9a5b00; background: #fff; border-radius: 4px; cursor: pointer; }`;
    document.head.append(s);
  }

  paintPanel();
})();
