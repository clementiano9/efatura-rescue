// Shared by server.ts, eval.ts and the browser. Code narrows, Jev decides, code gates.

export const CATEGORIES = {
  C03: { name: "Restauração", reason: "A meal or snack eaten on site at a café or restaurant: food at 13% VAT, often with a drink at 23%." },
  C04: { name: "Cabeleireiro", reason: "A haircut or beauty service: a single 23% VAT line at a typical service price of about €10 to €60." },
  C05: { name: "Saúde", reason: "Health spending: medicine at 6% VAT, or a medical or dental act that is exempt from VAT (CIVA art. 9)." },
  C06: { name: "Educação", reason: "Education or childcare fees, usually a VAT-exempt monthly fee from a school or crèche." },
  C08: { name: "Lares", reason: "Care home fees for an elderly or dependent person, exempt from VAT." },
  C09: { name: "Veterinário", reason: "A vet consultation or treatment for a pet, at 23% VAT." },
  C10: { name: "Passe público", reason: "A monthly public transport pass or ticket, at 6% VAT." },
  C11: { name: "Ginásios", reason: "A gym membership or class fee: a single 23% VAT line the size of a monthly fee, about €20 to €80." },
  C12: { name: "Jornais", reason: "A newspaper or magazine subscription, at 6% VAT." },
  C99: { name: "Outros", reason: "An ordinary shop purchase: groceries or bread to take away at 6%, or cosmetics, supplements, pet food or small items at 23%." },
};

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

export function allowedCategories(caes) {
  const set = new Set();
  for (const cae of caes) (CAE_TABLE[cae]?.cats ?? Object.keys(CATEGORIES)).forEach((c) => set.add(c));
  return [...set].sort();
}

const eur = (cents) => `€${(cents / 100).toFixed(2)}`;

export function buildState(inv) {
  const vat = inv.linhas.map((l) =>
    l.tipoTaxaIva === "ISE"
      ? `- exempt from VAT (reason ${l.motivoIsencao}): ${eur(l.valorTotal)}`
      : `- ${l.taxaIva / 100}% VAT: base ${eur(l.valorBaseTributavel)}, VAT ${eur(l.valorIva)}`,
  );
  return [
    `Merchant: ${inv.nomeEmitente}`,
    `Merchant activities (CAE): ${inv._cae.map((c) => `${c} ${CAE_TABLE[c]?.label ?? "unknown"}`).join("; ")}`,
    `Document type: ${inv.tipoDocumento}, date ${inv.dataEmissaoDocumento}`,
    `Invoice lines by VAT rate (no item names are available):`,
    ...vat,
    `Total: ${eur(inv.valorTotal)}`,
  ].join("\n");
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

// A "needs receipt" noul was tried and scored 0.2–0.6 on every invoice, so only choice confidence gates.
export const GATE = { confidence: 0.8 };

export function gate({ confidence }) {
  return confidence > GATE.confidence ? "auto" : "ask";
}

// 2025 rules (Millennium bcp IRS guide). Pending invoices count for nothing until classified.
const RULES = {
  C99: { base: "total", rate: 0.35, group: "gerais", cap: 250 },
  C05: { base: "total", rate: 0.15, group: "saude", cap: 1000 },
  C06: { base: "total", rate: 0.3, group: "educacao", cap: 800 },
  C08: { base: "total", rate: 0.25, group: "lares", cap: 403.75 },
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
    const base = (r.base === "vat" ? inv.valorIva : inv.valorTotal) / 100;
    groups[r.group] = Math.min(r.cap, (groups[r.group] ?? 0) + base * r.rate);
  }
  return Object.values(groups).reduce((a, b) => a + b, 0);
}
