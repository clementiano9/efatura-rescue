# e-Fatura Rescue: demo

Two local pages, both served by `bun server.ts`:
- **http://localhost:3210**: the original stand-alone mock, with a side panel that sorts the 11 sample invoices. CAE codes come from the sample data; no extension needed.
- **http://localhost:3210/fixture/resolverListaPendenciasAdquirenteForm.action**: a copy of the real "resolver pendências" page (same row IDs, buttons and paging library) for the Chrome extension in `../extension`. Use this one on stage: it's the real extension on a page shaped like the real portal.

## Run
```sh
cd demo
bun eval.ts          # mock-page mode: the full CAE list filters the options
bun eval.ts --hint   # extension mode: main CAE + business description only, all 16 categories
bun server.ts
```
`demo/.env` needs `TYPESAFE_API_KEY` (OpenRouter `sk-or-…` or TypeSafe) and, for the extension, `NIFPT_API_KEY`. Jev answers are saved to `jev-cache.json`, so the mock page works offline after one run. Editing an option sentence in `extension/lib/logic.js` invalidates the matching entries.

## How it decides
1. **Narrow (code):** on the mock page, `CAE_TABLE` limits the options to what the merchant's activities allow. The extension only has the main CAE from nif.pt, so it passes the CAE and description to Jev as hints and offers all categories.
2. **Decide (Jev):** one `category` choice per invoice. Each option's sentence is the reason shown to the user. The date is left out of the request so repeat invoices reuse one answer.
3. **Gate (code):** fill in the category when Jev's confidence is above 0.8. Otherwise the row turns amber and shows the runner-up.
4. **Submit (user):** nothing is ever submitted automatically.

The deduction total uses the 2025 IRS rates and caps (`RULES` in `extension/lib/logic.js`).

## Results (2026-09-25, jev-latest via OpenRouter)
| Mode | Correct | Filled in | Sent to the user |
|---|---|---|---|
| Mock page (full CAE list) | 11/11 | 8, all right | 3: pharmacy 76%, protein bar 69%, vet 56%; all best guesses right |
| Extension (main CAE + description) | 10/11 | 9, all right | 2: take-away bread 79% (right), protein bar 48% (wrong: Ginásios over Outros 47%) |

- Calls took 280–970 ms, measured from Lisbon.
- In both modes, every invoice filled in without asking was correct. The only wrong guess was held back for the user.
- A "needs receipt" yes/no question was dropped. Three wordings each scored about the same on every invoice (0.2–0.6), so it couldn't tell cases apart.
- Confidence moves a few points between runs, so a row near 0.8 can switch between filled in and amber.

## Demo script (2 min, extension on the fixture page)
1. "Every February you open e-Fatura and sort these by hand, one button per invoice."
2. Press **Sort pending invoices**. 9 rows turn green with their buttons pressed, and 2 turn amber.
3. Point at a reason: "Jev doesn't write text. This sentence is the option it picked."
4. Open the protein-bar row: 48% gym vs 47% other. "It knows it doesn't know, so it asks."
5. End on the euro total, then press Submeter yourself.
