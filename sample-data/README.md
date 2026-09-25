# e-Fatura sample set (synthetic)

18 invoices for tax year 2025: 7 already classified by AT, 11 pending (`estadoDocumento: "P"`). Each carries `_expected` (the right category + reason), so it doubles as an eval set for the classifier.

| File | What it is |
|---|---|
| `efatura_adquirente.json` | Shaped like the portal's `json/obterDocumentosAdquirente.action` response (`success`, `totalElementos`, `linhas`). Line fields copied from a real line sample in [faturas-bot](https://github.com/tuianog/faturas-bot/blob/main/data/linha_documento_exemplo.json); amounts in cents, `taxaIva` x100. |
| `efatura_flat.csv` | Our own flat schema (`;`-separated). **Not** the portal's "Obter dados para Excel" format; export a real one to get those columns. |
| `receipts/*.png` + `*.qr.txt` | Receipt images with AT-spec QR codes ([spec](https://www.audico.pt/wp-content/uploads/2020/08/Especificacoes_Tecnicas_Codigo_QR.pdf)) for the scan-a-paper-receipt path. |
| `merchants.json` | Merchants with CAE codes (Rev.3). |

## Real vs made up
- Real: the 4 chain NIFs (Continente, Pingo Doce, Mercadona, NOS), category codes C03-C12/C99 (from faturas-bot), VAT rates, QR field layout.
- Made up: every other merchant (names end in "(exemplo)", NIFs are random but checksum-valid), ATCUDs, hashes, amounts. Buyer NIF 123456789 is AT's example NIF.
- e-Fatura holds totals per VAT rate, not item names. The pending cases are built so VAT mix + CAE + amount decide the category, which is all a real tool gets.

## Notes
- CAE lookup by NIF: [nif.pt API](https://www.nif.pt/api/), free key, but 1 request/minute and 100/day, so cache results before the demo.
- Regenerate: `uv run --with "qrcode[pil]" python generate.py`
