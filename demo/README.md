# e-Fatura Rescue: demo

A local page that stands in for e-Fatura's pending-invoices list, plus a side panel that sorts all 11 sample invoices in one pass. There's no Chrome extension, no Finanças login and no nif.pt lookups: CAE codes come from the sample data.

## Run
```sh
echo "TYPESAFE_API_KEY=..." > demo/.env   # bun loads it automatically
cd demo
bun eval.ts      # accuracy + response time on the 11 pending invoices
bun server.ts    # http://localhost:3210
```

Every Jev answer is saved to `jev-cache.json`, so once `eval.ts` has run with a key the demo works offline. If you change a criteria sentence in `logic.js`, the cache entry no longer matches and Jev is called again.

## How it decides
1. **Narrow (code):** `CAE_TABLE` in `logic.js` lists the categories each merchant activity allows. If only one is left, the invoice is resolved without Jev (in the sample data, only the care home).
2. **Decide (Jev):** one call per remaining invoice, with a `category` choice (allowed options only; each option's sentence is the reason shown to the user).
3. **Gate (code):** pre-fill the category when Jev's confidence is above 0.8. Otherwise the row turns amber with "Check your receipt" and the runner-up category.

Jev is reached through OpenRouter when the key starts with `sk-or-`, and through TypeSafe directly otherwise. Set `TYPESAFE_BASE_URL` to override this.

## Results (2026-09-25, jev-latest via OpenRouter)
- 10/10 correct on the invoices the CAE table couldn't settle, and 11/11 overall.
- 8 pre-filled, 3 sent to the user: the café (74% confidence), the gym protein bar (70%) and the vet (65%). All 3 best guesses were right.
- About 490–575 ms per call, measured from Lisbon.
- A "needs receipt" noul was dropped. Three wordings each scored the same on every invoice (0.2–0.6), so it told the invoices apart no better than guessing.
4. **Submit (user):** nothing is ever submitted automatically.

The deduction total uses the 2025 IRS rates and caps (`RULES` in `logic.js`).

## Demo script (2 min)
1. "Every February you open e-Fatura and sort these by hand. The portal has no bulk edit."
2. Click **Sort pending invoices**. 8 rows pre-fill, and 3 turn amber.
3. Point at a reason: "Jev doesn't write text. This sentence is the option it picked."
4. Open the vet row: a vet clinic that also runs a pet shop, with the same VAT rate either way. It asks instead of guessing.
5. End on the euro total.
