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
    paintPanel();
    showAllRows();
    await run(scanRows());
    panel.start.hidden = true;
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
    // The pressed button already names the category, so a filled-in row only shows Jev's confidence; the reason opens on click.
    const why = (code) => `<button type="button" class="efr-why" aria-expanded="false">why?</button></span><span class="efr-reason" hidden>${L.CATEGORIES[code].reason}</span>`;
    let html = "";
    if (e.status === "deciding") { tr.classList.add("efr-busy"); html = "Jev is deciding…"; }
    else if (e.status === "applied") { tr.classList.add("efr-auto"); html = `<span class="efr-line">${e.accepted ? "Your choice · " : ""}Jev ${pct}% ${why(e.code)}`; }
    else if (e.status === "user") { tr.classList.add("efr-auto"); html = "Your choice"; }
    else if (e.status === "ask") {
      tr.classList.add("efr-ask");
      const [, second] = Object.entries(d.probabilities).sort((a, b) => b[1] - a[1]);
      const alt = second ? `, or ${L.CATEGORIES[second[0]].name} ${Math.round(second[1] * 100)}%` : "";
      const wait = d.caeKnown ? "" : " Merchant lookup pending; Jev will retry.";
      html = `<b>Check your receipt.</b> Best guess ${name} ${pct}%${alt}.${wait}
        <span class="efr-line"><button type="button" class="efr-apply">Use ${name}</button> ${why(e.code)}`;
    } else if (e.status === "mismatch" || e.status === "error") { tr.classList.add("efr-ask"); html = e.note; }
    if (!html) return;
    const div = document.createElement("div");
    div.className = "efr-note";
    div.innerHTML = html;
    div.querySelector(".efr-apply")?.addEventListener("click", () => { e.accepted = true; click(id, e.code); paintRow(id); paintPanel(); });
    div.querySelector(".efr-why")?.addEventListener("click", (ev) => {
      const reason = div.querySelector(".efr-reason");
      reason.hidden = !reason.hidden;
      ev.currentTarget.setAttribute("aria-expanded", String(!reason.hidden));
    });
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
    panel.count.textContent = `${total} pending`;
    panel.stats.innerHTML = `
      <div><b>${done.length}</b><span>filled in</span></div>
      <div><b>${asks.length}</b><span>need you</span></div>
      <div><b>${all.length}/${total}</b><span>seen</span></div>`;
    panel.money.innerHTML = `<b>€${ready.toFixed(2)}</b><span>ready to submit</span>${waiting > 0 ? `<small>€${waiting.toFixed(2)} more waiting on you</small>` : ""}`;
    panel.results.hidden = !started;
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
    // Icons: Lucide "settings" and "chevron-down".
    const icon = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    root.innerHTML = `<style>
      :host { --green: #1f5f4a; --green-dark: #174a39; --ink: #1d2622; --muted: #55635d; --rule: #dde3e0; --amber: #7a4a00; }
      .p { width: 272px; font-family: inherit; font-size: 13px; line-height: 1.4; color: var(--ink); background: #fff; border: 1px solid #b7c3bd; border-radius: 4px; box-shadow: 0 2px 8px rgba(20, 45, 35, .2); overflow: hidden; }
      ::selection { background: #cfe3da; }
      header { display: flex; align-items: center; gap: 2px; padding: 6px 6px 6px 12px; color: #fff; background: var(--green); }
      header .mark { margin-right: 8px; height: 22px; width: auto; }
      header div { flex: 1; } header strong { font-size: 13px; } header span { display: block; font-size: 11px; line-height: 1.2; color: #c9e0d6; }
      .icon { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; color: #e3efe9; background: none; border: 0; border-radius: 3px; cursor: pointer; }
      .icon:hover { background: rgba(255, 255, 255, .14); }
      .min svg { transition: transform .2s cubic-bezier(.2, .8, .2, 1); }
      .p.small .min svg { transform: rotate(180deg); }
      button:focus-visible { outline: 2px solid #9fd3bd; outline-offset: -2px; }
      .body { padding: 12px; } .p.small .body { display: none; }
      .start { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); }
      .go { white-space: nowrap; padding: 6px 12px; font: inherit; font-weight: 600; color: #fff; background: var(--green); border: 1px solid var(--green-dark); border-radius: 4px; cursor: pointer; }
      .go:hover { background: var(--green-dark); } .go:disabled { opacity: .7; cursor: progress; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 12px; padding: 8px 0; border-block: 1px solid var(--rule); }
      .start[hidden] + .results .stats { margin-top: 0; padding-top: 0; border-top: 0; }
      .stats div + div { padding-left: 10px; border-left: 1px solid var(--rule); }
      .stats b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; } .stats span { font-size: 11px; color: var(--muted); }
      .money { margin-top: 10px; } .money b { margin-right: 6px; font-size: 22px; color: var(--green); font-variant-numeric: tabular-nums; }
      .money small { display: block; font-size: 12px; color: var(--amber); }
      .status { margin: 8px 0 0; font-size: 12px; color: var(--amber); } .status:empty { display: none; }
      [hidden] { display: none !important; }
    </style>
    <section class="p" aria-label="e-Fatura Rescue">
      <header>
        <img class="mark" src="${chrome.runtime.getURL("icons/mark-white.png")}" alt="" width="21" height="22">
        <div><strong>e-Fatura Rescue</strong><span>decisions by Jev</span></div>
        <button class="icon settings" title="Settings" aria-label="Settings">${icon('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>')}</button>
        <button class="icon min" title="Collapse" aria-label="Collapse" aria-expanded="true">${icon('<path d="m6 9 6 6 6-6"/>')}</button>
      </header>
      <div class="body">
        <div class="start"><span class="count"></span><button class="go">Sort pending invoices</button></div>
        <div class="results" hidden><div class="stats"></div><div class="money"></div></div>
        <p class="status"></p>
      </div>
    </section>`;
    document.body.append(host);
    const $ = (s) => root.querySelector(s);
    $(".go").addEventListener("click", sort);
    $(".settings").addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-options" }));
    $(".min").addEventListener("click", () => {
      const small = $(".p").classList.toggle("small");
      $(".min").setAttribute("aria-expanded", String(!small));
      $(".min").title = small ? "Expand" : "Collapse";
    });
    return { go: $(".go"), start: $(".start"), count: $(".count"), results: $(".results"), stats: $(".stats"), money: $(".money"), status: $(".status") };
  }

  function injectStyles() {
    const s = document.createElement("style");
    s.textContent = `
      #listaPendencias tr.efr-auto > td { background: #e3efe9 !important; }
      #listaPendencias tr.efr-ask > td { background: #fbf0dc !important; }
      #listaPendencias tr.efr-busy > td { opacity: .6; }
      .efr-note { margin-top: 4px; font-size: 12px; line-height: 1.4; max-width: 44ch; font-variant-numeric: tabular-nums; }
      tr.efr-auto .efr-note { color: #245c47; }
      tr.efr-ask .efr-note { color: #6b4200; }
      .efr-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-top: 2px; }
      .efr-reason { display: block; margin-top: 2px; } .efr-reason[hidden] { display: none; }
      .efr-why { padding: 0; font: inherit; color: inherit; background: none; border: 0; text-decoration: underline dotted; text-underline-offset: 2px; cursor: pointer; }
      .efr-apply { padding: 1px 8px; font: inherit; font-weight: 600; color: #6b4200; background: #fff; border: 1px solid #c79a55; border-radius: 4px; cursor: pointer; }
      .efr-apply:hover { background: #fff7ea; }
      .efr-why:focus-visible, .efr-apply:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }`;
    document.head.append(s);
  }

  paintPanel();
})();
