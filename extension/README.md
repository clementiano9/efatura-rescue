# e-Fatura Rescue: Chrome extension

Runs on e-Fatura's "resolver pendências" page. It reads each pending invoice, fetches its VAT lines, asks Jev for the IRS category, and presses the category button when Jev's confidence is above 0.8. It never presses Submeter.

## Set up (once)
1. Put both keys in `demo/.env`:
   ```
   TYPESAFE_API_KEY=sk-or-...   # OpenRouter or TypeSafe key for Jev
   NIFPT_API_KEY=...            # free key from nif.pt/api
   ```
2. `bun --env-file=demo/.env extension/sync-keys.ts` writes `extension/config.local.json` (git-ignored). You can also type the keys into the extension's Settings page instead.
3. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick the `extension/` folder.

## Use
- **Real portal:** open [resolver pendências](https://faturas.portaldasfinancas.gov.pt/resolverListaPendenciasAdquirenteForm.action) with page translation **off**, then press **Sort pending invoices** in the panel at the bottom right.
- **Stage demo:** `cd demo && bun server.ts`, then open http://localhost:3210/fixture/resolverListaPendenciasAdquirenteForm.action. It's a mock of the same page built from the sample invoices.

Green rows are filled in. Amber rows show Jev's best guess and runner-up with a **Use …** button. Check those, then press the portal's own **Submeter**.

## How it works
| Step | Where | What |
|---|---|---|
| Read | `content.js` | Each row `tr#documento_<id>`: NIF, name, number, date, VAT, total. It switches the list to 50 rows, and rows on later list pages are sorted when you open those pages. |
| VAT lines | `content.js` | Fetches `detalheDocumentoAdquirente.action` with your session and reads the `dadosLinhasDocumento` array |
| Merchant activity | `background.js` | nif.pt main CAE + business description, cached forever. The free limit is 10 an hour, so new merchants queue; an amber row is re-decided when its lookup arrives. |
| Decide | `background.js` + `lib/logic.js` | One Jev choice over all 16 portal categories. Answers are cached by request, so repeat invoices (the same monthly pass) cost nothing. |
| Apply | `content.js` | Clicks `button[value=code]` only if the button's `data-original-title` matches the expected label. A button you pick yourself always wins. |
| Same-sector pop-up | `content.js` | When one merchant has several invoices on the page, the portal asks whether to give them all the same sector (`#modalPendencias`). The extension clicks one button at a time and answers **Só esta** (`#oneBtn`), because Jev decides each invoice separately. It never presses `#allBtn`, and a pop-up you trigger yourself is left for you. |

## Tested (2026-09-25, Chrome for Testing, on the mock page)
- Sort filled in 9 of 11 sample invoices, all correct. The gym protein bar (Jev 48% Ginásios vs 47% Outros) and the take-away bread (79%) stayed amber.
- The Jev answers were real ones recorded by `demo/eval.ts --hint`, loaded into storage, because no Jev key was set during the test.
- A relabelled button was not clicked. A category the user picked before sorting was kept. **Use …** applied the best guess.
- Paging with DataTables 1.9: Sort switched 10 rows to 50. With a 5-row list, opening pages 2 and 3 sorted those rows too.
- The service worker was killed and restarted, and the next run worked (cache is in `chrome.storage`).
- Same-sector pop-up (mock uses the real IDs): every pop-up was answered with Só esta and none was left open. The two amber rows of repeat merchants stayed unselected, so All was never pressed.

## Real portal (2026-09-25, first run)
- 49 of 50 pending invoices were filled in, and 1 was left for the user. 7 merchants were queued for nif.pt.
- The same-sector pop-up appeared during the run; handling it was added after this run.

## Not yet tested on the real portal
- Whether Submeter saves picks made on list pages you're not currently viewing
- The detail-page fetch with a real session, and the nif.pt response for real merchants
- The error rows the portal shows for a rejected category
- C13–C15 (books, arts, museums) add €0 to the total because their deduction rates aren't confirmed
