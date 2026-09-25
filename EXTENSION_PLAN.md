# e-Fatura Rescue: Chrome extension
## Problem
The demo runs on a mock page. The extension has to read your real pending invoices, decide each one with Jev, and press the right category button on the resolve page, leaving Submit to you.

## Solution
A plain-JS Manifest V3 extension (no build step). A content script on the resolve page lists the pending invoices, fetches each one's VAT lines with your session, asks the background worker for a decision (nif.pt CAE + Jev, both cached), then clicks `button[value=code]` and colours the row.

## Decisions (2026-09-25)
- Target both your real account and an anonymised copy of the page for the stage demo
- The extension clicks the category buttons; you press Submit
- CAE: nif.pt main CAE + business description, cached per NIF, queued (free limit is 10 an hour). The CAE table is a hint to Jev, not a filter.

## Resolve page facts (from your paste)
- URL `resolverListaPendenciasAdquirenteForm.action`; table `#listaPendencias`, DataTables, 10 rows a page (the length select `listaPendencias_length` goes up to 50)
- Row `tr#documento_<idDocumento>`. Cells: 0 `"NIF - Name"`, 1 invoice number, 2 date, 3 VAT, 4 total, 5 `.selecaoSector` buttons
- Buttons: `button[value="C01".."C15","C99"]`, with the Portuguese label in `data-original-title`; the chosen one gets `.active`
- Codes: C01 car repair, C02 motorbike repair, C03 restaurants/accommodation, C04 hairdressers, C05 health, C06 education, C07 property, C08 care homes, C09 vets, C10 public transport, C11 gyms, C12 newspapers, C13 books, C14 arts, C15 museums, C99 other
- Detail page `detalheDocumentoAdquirente.action?idDocumento&dataEmissaoDocumento`: the VAT lines are in `dadosLinhasDocumento`
- From Lazy eFatura, still unconfirmed: Submit `#guardarResolverListaPendenciasBtn`, confirm dialog `#modalPendencias #allBtn`, error row `td[colspan]`

## Files to create
- `extension/manifest.json`: content script on the resolve URLs + `localhost:3210/fixture/*`; side panel; storage; hosts nif.pt, openrouter.ai
- `extension/portal.js`: pending list (`obterDocumentosAdquirente`, status P); detail pages 3 at a time; parse `dadosLinhasDocumento`
- `extension/content.js`: on every table redraw, apply saved decisions to the visible rows; colour them; watch for error rows
- `extension/background.js`: nif.pt queue + cache; Jev + cache (state without the date, so the 5 Metro and 5 Pingo Doce rows reuse answers)
- `extension/panel.html|js`: all 50 invoices with decision, confidence, reason; "Sort", "Apply confident"; the euro total
- `demo/logic.js`: all 16 codes with option sentences + deduction rules (C13–C15 need rates checked); `buildState` takes the CAE + description
- `demo/fixture/`: anonymised resolve page + detail pages (raw pastes git-ignored)

## Verification
- Fixture: the 11 sample invoices get the right `.active` button; low-confidence ones stay unclicked
- Real page: choose on page 1 and page 2, submit, and confirm both pages were saved (tells us whether other-page choices survive)
- A button whose label doesn't match its code is never clicked
- A reload re-applies from the cache without calling Jev or nif.pt
