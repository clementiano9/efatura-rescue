# Handoff: e-Fatura Rescue

Written 2026-09-25. Shelved for the 4-5 hour Lisbon Jev hackathon, where Clement chose the prompt checker instead (see `~/ai-projects/jev-prompt-check/HANDOFF.md`). Keep this for a longer hackathon (2 days) or a side project. Only the sample data exists; nothing else is built.

## Simplified demo (built 2026-09-25)
`demo/` holds a working cut-down version: a local mock of the pending-invoices page, the CAE table, Jev calls through a small bun server, the confidence gate and a euro total. It leaves out the extension, portal scraping and nif.pt. Run through OpenRouter, Jev got 10/10 on the ambiguous invoices and pre-filled 8 of the 11. The `needs_receipt` noul in the design below didn't work, so the gate uses choice confidence only. Results and the run steps are in `demo/README.md`.

## What to build
A Chrome extension that works on the logged-in e-Fatura portal. It reads the buyer's **pending** invoices (the ones AT couldn't classify), decides the IRS deduction category for each, pre-selects it, and leaves the Submit click to the user. Jev decides each category; plain code fetches the invoices, looks up the merchant, and narrows the options.

**The pitch in one line:** "Every February you open e-Fatura and sort pending invoices by hand. This does it in one pass, and asks you only about the ones it isn't sure of."

## Why it was shelved
- **Too big for 4-5 hours.** Only the category decision is Jev work. Reading the portal, looking up merchants, caching and applying the fix all come before or after it.
- **Awkward live demo.** It needs a real Finanças login on stage, or a mock portal.
- **The public vote favours the prompt checker.** Everyone has used ChatGPT; only people who file Portuguese taxes feel this problem.

## Competitors (checked 2026-09-25)
- **[Otimiza.pt](https://otimiza.pt).** The closest one. You export a CSV from e-Fatura and upload it. It looks up each merchant's CAE code and suggests categories, for €5 per analysis. The site shows 315 registered users. It only *suggests*: you still change each invoice by hand in the portal, because the portal has no bulk edit.
- **[Lazy eFatura](https://github.com/jvPalma/lazy-efatura).** Open-source Chrome extension (MIT). It detects invoices on the portal's pending-invoices page and clicks the category button you assigned to that merchant's NIF. The user assigns every category; there's no AI.
- **[faturas-bot](https://github.com/tuianog/faturas-bot).** A Python script with a hard-coded NIF → category map. It calls the portal endpoints directly using a copied session cookie.
- **The gap:** nobody combines deciding the category *and* applying it in the portal.
- Someone posted Jev [classifying a company's invoices](https://x.com/iagolast/status/2100694100160745746). That's company bookkeeping, not personal IRS, but expect judges to ask how this is different.

## How the data flows
Users never upload invoices. e-Fatura already holds every invoice issued to their NIF.

1. **Fetch.** The content script runs on `faturas.portaldasfinancas.gov.pt` and uses the user's own session. Endpoints, taken from `faturas-bot/src/faturas.py`:
   - `GET /json/obterDocumentosAdquirente.action?dataInicioFilter=YYYY-MM-DD&dataFimFilter=YYYY-MM-DD&estadoDocumentoFilter=P` returns JSON `{success, totalElementos, linhas: [...]}`. Each item includes `idDocumento`, `nifEmitente`, `nomeEmitente` and `dataEmissaoDocumento`.
   - `GET /detalheDocumentoAdquirente.action?idDocumento=…&dataEmissaoDocumento=…` returns HTML. The invoice lines are in a JS variable `dadosLinhasDocumento = [...]`, holding a base amount, VAT and VAT rate per line. **There are no item names.**
   - `POST /resolverPendenciaAdquirente.action` (form-encoded) with `idDocumento`, `dataEmissaoDocumento`, `dataEmissaoDocumentoOriginal`, `linhasDocumento`, `ambitoAquisicaoPend=<code>`. Success is a 302.
   - These are undocumented internal endpoints that can change without notice. Safer default: pre-select the category in the page UI (as Lazy eFatura does) and let the user click Submit, rather than POSTing yourself.
2. **Look up.** Get the merchant's CAE codes from its NIF via the [nif.pt API](https://www.nif.pt/api/). A key is free but limited to 1 request/min and 100/day, so cache every NIF and pre-warm the cache before any demo.
3. **Narrow.** A CAE → allowed-categories table in code removes impossible options (a barber can only be Cabeleireiro or Outros, never Saúde). Merchants with only one allowed category are resolved without Jev.
4. **Decide (Jev).** One call per remaining invoice (design below).
5. **Gate.** High confidence: pre-select the category. Low confidence: show the invoice to the user with the reason and "check your receipt".

Other ways in, if the extension route is blocked:
- **CSV export.** The portal's "Obter dados para Excel" link appears after you search on "Verificar Faturas". Despite the name, the file is CSV. We haven't seen its column layout yet.
- **Paper receipts.** The QR code on a receipt holds all the tax fields (AT spec, Portaria 195/2020), so no OCR is needed. This is the only route for invoices the merchant never reported.

## Category codes
Confirmed in faturas-bot: `C03` Restauração, `C04` Cabeleireiro, `C05` Saúde, `C06` Educação, `C07` Imóveis, `C08` Lares, `C09` Veterinário, `C10` Passe público, `C11` Ginásios, `C12` Jornais, `C99` Outros (general expenses).
**Unknown:** the code for car repair shops (Oficinas) and anything else in the portal dropdown. Read them from the dropdown's HTML.

## Jev design
API details are in the prompt-check handoff (`POST https://api.typesafe.ai/v1/systemone`, body `{state, model, questions}`).

- **`state`**: a plain-text summary of one invoice: merchant name, each CAE with its description, VAT lines (rate + amount), total, date, document type, and the user's past choice for this NIF if there is one.
- **`category`** (choice): only the categories the CAE table allows. Each option's `criteria` is a full sentence, because Jev returns no text and that sentence *is* the reason the user sees. Example for Restauração: "Food at 13% VAT, often with a drink at 23%, at a café or restaurant, meaning a meal eaten on site."
- **`needs_receipt`** (noul): "The category can't be told from the amounts and VAT rates alone; the paper receipt is needed."
- **Gate:** start by auto-selecting when `confidence > 0.8 && needs_receipt < 0.4`, then tune against the sample set.
- **For the pitch:** report Jev's accuracy on the ambiguous invoices on its own, so judges can see what Jev adds beyond the CAE table.

## Signals that decide a category (use them in the criteria)
- VAT mix: 6% is essentials (bread, medicine), 13% is restaurant food, 23% is standard, and exempt (CIVA art. 9) is medical or education services.
- Pharmacy: 6% lines count as health. 23% lines count as health only with a prescription; otherwise they're general. Double-check this rule against the current IRS code before relying on it.
- Amount: gym membership vs a protein bar; haircut vs a shampoo bottle.
- Merchants with more than one CAE are the main reason invoices end up pending.

## Sample data (already built)
`sample-data/`: 18 invoices, 11 of them pending, each with the right answer and a reason. See `sample-data/README.md` for which parts are real and which are made up.
- `efatura_adquirente.json` follows the shape of the `obterDocumentosAdquirente` response.
- `efatura_flat.csv` uses our own columns (not the portal export's format).
- `receipts/` has receipt images with AT-spec QR codes. Decoding them back hasn't been tested yet.
- Regenerate with `uv run --with "qrcode[pil]" python sample-data/generate.py`.

## Open questions
- The real "Obter dados para Excel" column layout. Export one from Clement's own account.
- The missing category codes (see above).
- CAE version: Portugal may have moved to CAE Rev.4. The sample data uses Rev.3 codes, so check which one nif.pt returns.
- Jev's accuracy on Portuguese merchant names and CAE descriptions.
- Whether automating the portal is acceptable to AT. Leaving Submit to the user avoids most of the risk.

## Build plan (about 2 days)
1. **Hours 0-2:** run Jev from a script on the sample JSON. Measure accuracy on the 11 pending invoices and response time.
2. **Hours 2-4:** build the CAE → allowed-categories table and the nif.pt cache. Write the option sentences.
3. **Hours 4-10:** build the Manifest V3 extension: a content script on the pending-invoices page, a background worker calling Jev, a side panel listing each invoice with its decision, confidence and reason, and pre-selecting in the page.
4. **Hours 10-12:** test on Clement's real pending invoices and fix what the sample set missed.
5. **Demo:** show the portal's list of pending invoices, run the extension, and watch 10 of them resolve in under a second. The vet invoice gets flagged as low confidence and asks about the receipt. End on the added deduction in euros.

## Tracks
Build with Jev first: this uses all three answer types (a choice for the category, a yes/no for "needs receipt", and the confidence number to decide auto-apply vs ask). Social Good is a stretch ("households lose deductions to pending invoices"); only use it if there's evidence to back it.
