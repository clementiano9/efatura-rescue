// Shared by the extension, demo/server.ts and demo/eval.ts. Code builds the question, Jev decides, code gates.
// Invoice shape: { id, nif, merchant, docType, date, total, vat, lines: [{ rate, base, vat, total, exempt, reason }], caes: [], activity }
// Money is in cents; rate is a percentage (6, 13, 23, 0).

// `title` is the portal button's data-original-title; content.js refuses to click when it doesn't match.
export const CATEGORIES = {
  C01: { name: "Reparação automóvel", title: "Manutenção e reparação de veículos automóveis", reason: "Car maintenance or repair at a garage, usually 23% VAT on parts and labour." },
  C02: { name: "Reparação motociclos", title: "Manutenção e reparação de motociclos, de suas peças e acessórios", reason: "Motorbike maintenance, repair, parts or accessories, at 23% VAT." },
  C03: { name: "Restauração", title: "Alojamento, restauração e similares", reason: "A meal or snack eaten on site at a café or restaurant: food at 13% VAT, often with a drink at 23%." },
  C04: { name: "Cabeleireiro", title: "Atividades de salões de cabeleireiro e institutos de beleza", reason: "A haircut or beauty service: a single 23% VAT line at a typical service price of about €10 to €60." },
  C05: { name: "Saúde", title: "Saúde", reason: "Health spending: medicine at 6% VAT, or a medical or dental act that is exempt from VAT (CIVA art. 9)." },
  C06: { name: "Educação", title: "Educação", reason: "Education or childcare fees, usually a VAT-exempt monthly fee from a school or crèche." },
  C07: { name: "Imóveis", title: "Imóveis", reason: "Rent or other costs for the home you live in, usually exempt from VAT." },
  C08: { name: "Lares", title: "Lares", reason: "Care home fees for an elderly or dependent person, exempt from VAT." },
  C09: { name: "Veterinário", title: "Atividades veterinárias", reason: "A vet consultation or treatment for a pet, at 23% VAT." },
  C10: { name: "Passe público", title: "Aquisição de passes mensais ou de bilhetes para utilização de transportes públicos coletivos", reason: "A monthly public transport pass or ticket, at 6% VAT." },
  C11: { name: "Ginásios", title: "Ginásios", reason: "A gym membership or class fee: a single 23% VAT line the size of a monthly fee, about €20 to €80." },
  C12: { name: "Jornais", title: "Jornais e Revistas", reason: "A newspaper or magazine subscription, at 6% VAT." },
  C13: { name: "Livros", title: "Comércio a retalho de livros", reason: "Books bought from a bookshop, at 6% VAT." },
  C14: { name: "Artes", title: "Atividades artísticas e literárias", reason: "Tickets or fees for artistic or literary activities such as shows and concerts." },
  C15: { name: "Museus", title: "Atividades dos museus e monumentos históricos", reason: "Tickets to a museum or historic monument." },
  C99: { name: "Outros", title: "Outros", reason: "An ordinary shop purchase: groceries or bread to take away at 6%, or cosmetics, supplements, pet food or small items at 23%." },
};
export const ALL_CODES = Object.keys(CATEGORIES);

// CAE Rev.3 → categories an invoice from that activity can fall under.
export const CAE_TABLE = {
  "47111": { label: "Supermarket", cats: ["C99"] },
  "61100": { label: "Telecoms", cats: ["C99"] },
  "47730": { label: "Pharmacy", cats: ["C05", "C99"] },
  "86230": { label: "Dental practice", cats: ["C05"] },
  "47782": { label: "Optical goods retail", cats: ["C05", "C99"] },
  "10711": { label: "Bread and pastry making", cats: ["C99"] },
  "56107": { label: "Pastry shop and tea house", cats: ["C03", "C99"] },
  "56101": { label: "Traditional restaurant", cats: ["C03"] },
  "93130": { label: "Gym and fitness centre", cats: ["C11"] },
  "47640": { label: "Sports goods retail", cats: ["C99"] },
  "96021": { label: "Hairdresser and barber", cats: ["C04"] },
  "47750": { label: "Cosmetics retail", cats: ["C99"] },
  "75000": { label: "Veterinary activities", cats: ["C09"] },
  "47760": { label: "Pet shop, flowers and plants retail", cats: ["C99"] },
  "49310": { label: "Urban passenger transport", cats: ["C10"] },
  "88910": { label: "Childcare without accommodation (crèche)", cats: ["C06", "C99"] },
  "85100": { label: "Pre-school education", cats: ["C06"] },
  "58130": { label: "Newspaper publishing", cats: ["C12"] },
  "87301": { label: "Residential care for the elderly", cats: ["C08"] },
};

// Only valid when `caes` is the merchant's full list; with just the main CAE, offer ALL_CODES instead.
export function allowedCategories(caes) {
  const set = new Set();
  for (const cae of caes) (CAE_TABLE[cae]?.cats ?? ALL_CODES).forEach((c) => set.add(c));
  return [...set].sort();
}

// The portal's detail page and the sample data share this line shape.
export function fromPortalLines(linhas) {
  return linhas.map((l) => ({
    rate: l.taxaIva / 100,
    base: l.valorBaseTributavel,
    vat: l.valorIva,
    total: l.valorTotal,
    exempt: l.tipoTaxaIva === "ISE",
    reason: l.motivoIsencao,
  }));
}

const eur = (cents) => `€${(cents / 100).toFixed(2)}`;

// The date is left out so repeat invoices (the same monthly pass) produce the same request and hit the cache.
export function buildState(inv) {
  const caes = inv.caes?.length
    ? inv.caes.map((c) => `${c} ${CAE_TABLE[c]?.label ?? ""}`.trim()).join("; ")
    : "unknown";
  const lines = inv.lines?.length
    ? inv.lines.map((l) =>
        l.exempt
          ? `- exempt from VAT (reason ${l.reason}): ${eur(l.total)}`
          : `- ${l.rate}% VAT: base ${eur(l.base)}, VAT ${eur(l.vat)}`,
      )
    : [`- breakdown by rate unavailable; VAT in total ${eur(inv.vat)}`];
  return [
    `Merchant: ${inv.merchant}`,
    `Merchant activities (CAE): ${caes}`,
    ...(inv.activity ? [`Merchant's registered business description: ${inv.activity}`] : []),
    `Document type: ${inv.docType}`,
    `Invoice lines by VAT rate (no item names are available):`,
    ...lines,
    `Total: ${eur(inv.total)}`,
    ...(inv.history?.length ? [historyLine(inv.history)] : []),
  ].join("\n");
}

// Other invoices from the same merchant that were already settled, as evidence, not an instruction:
// the same shop can sell a meal and a loaf of bread, so the amounts are included for comparison.
export function historyLine(history) {
  const byCode = {};
  for (const h of history) (byCode[h.code] ??= []).push(h);
  const parts = Object.entries(byCode).map(([code, hs]) => {
    const totals = hs.map((h) => h.total).sort((a, b) => a - b);
    const range = totals[0] === totals.at(-1) ? eur(totals[0]) : `${eur(totals[0])} to ${eur(totals.at(-1))}`;
    return `${hs.length} as ${CATEGORIES[code].name} (totals ${range})`;
  });
  return `Other invoices from this merchant already classified: ${parts.join("; ")}`;
}

export function buildQuestions(allowed) {
  return {
    category: {
      type: "choice",
      instructions: "Which Portuguese IRS deduction category does this personal purchase belong to?",
      criteria: Object.fromEntries(allowed.map((c) => [c, CATEGORIES[c].reason])),
    },
  };
}

export const jevRequest = (inv, allowed) => ({ state: buildState(inv), model: "jev-latest", questions: buildQuestions(allowed) });

// A "needs receipt" noul was tried and scored 0.2–0.6 on every invoice, so only choice confidence gates.
export const GATE = { confidence: 0.8 };

export function readAnswer(answers) {
  const { choice, probabilities, confidence } = answers.category;
  return { code: choice, probabilities, confidence, action: confidence > GATE.confidence ? "auto" : "ask" };
}

// 2025 rules (Millennium bcp IRS guide). Pending invoices count for nothing until classified.
// C13–C15 are left out: their deduction rules aren't confirmed yet, so they add €0.
const RULES = {
  C99: { base: "total", rate: 0.35, group: "gerais", cap: 250 },
  C05: { base: "total", rate: 0.15, group: "saude", cap: 1000 },
  C06: { base: "total", rate: 0.3, group: "educacao", cap: 800 },
  C07: { base: "total", rate: 0.15, group: "imoveis", cap: 600 },
  C08: { base: "total", rate: 0.25, group: "lares", cap: 403.75 },
  C01: { base: "vat", rate: 0.15, group: "iva", cap: 250 },
  C02: { base: "vat", rate: 0.15, group: "iva", cap: 250 },
  C03: { base: "vat", rate: 0.15, group: "iva", cap: 250 },
  C04: { base: "vat", rate: 0.15, group: "iva", cap: 250 },
  C11: { base: "vat", rate: 0.3, group: "iva", cap: 250 },
  C09: { base: "vat", rate: 0.35, group: "iva", cap: 250 },
  C10: { base: "vat", rate: 1, group: "passe", cap: 250 },
  C12: { base: "vat", rate: 1, group: "iva", cap: 250 },
};

export function deduction(items) {
  const groups = {};
  for (const { inv, code } of items) {
    const r = RULES[code];
    if (!r) continue;
    const base = (r.base === "vat" ? inv.vat : inv.total) / 100;
    groups[r.group] = Math.min(r.cap, (groups[r.group] ?? 0) + base * r.rate);
  }
  return Object.values(groups).reduce((a, b) => a + b, 0);
}

// "63,37 €", "1.234,56 €" and (with page translation on) "€63.37" → cents.
export function parseEuro(text) {
  let s = String(text).replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
