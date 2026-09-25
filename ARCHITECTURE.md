# Architecture

e-Fatura Rescue is a Chrome extension that runs on the portal's "resolver pendências" page. It works out the IRS category for each pending invoice, presses the category button when it's confident, and leaves the Submeter button to the user.

## Components

```mermaid
flowchart LR
  subgraph Browser["User's Chrome (logged into e-Fatura)"]
    Page["Resolve page<br/>#listaPendencias"]
    CS["content.js<br/>reads rows, clicks buttons,<br/>in-page panel"]
    BG["background.js<br/>service worker"]
    Logic["lib/logic.js<br/>categories, CAE table,<br/>Jev request, gate, deduction rules"]
    Store[("chrome.storage<br/>keys, Jev cache,<br/>NIF cache, NIF queue")]
  end
  Portal["Portal detail page<br/>detalheDocumentoAdquirente.action"]
  NIF["nif.pt API<br/>main CAE + activity"]
  Jev["Jev (TypeSafe System One)<br/>via OpenRouter"]

  Page <--> CS
  CS -- "fetch with the user's session" --> Portal
  CS -- "decide / status" --> BG
  BG -- "nif-updated" --> CS
  CS -.uses.-> Logic
  BG -.uses.-> Logic
  BG <--> Store
  BG -- "1 lookup per new merchant,<br/>max 10 an hour" --> NIF
  BG -- "POST /v1/systemone" --> Jev
```

| Part | Job |
|---|---|
| `content.js` | Runs inside the portal page. Reads each invoice row, fetches its VAT lines, shows the panel, and clicks the category buttons. |
| `background.js` | Holds the API keys and makes every outside call (nif.pt and Jev). Caches the answers so repeat invoices cost nothing. |
| `lib/logic.js` | Shared, pure code: the 16 categories and their option sentences, the CAE table, how the Jev request is built and read, the 0.8 gate, and the 2025 deduction rules. |
| `demo/` | A bun server with a copy of the resolve page (`fixture.ts`) for the stage demo, plus `eval.ts` to measure Jev on the sample invoices. |

## How one invoice is sorted

```mermaid
sequenceDiagram
  actor U as User
  participant CS as content.js
  participant P as Portal
  participant BG as background.js
  participant N as nif.pt
  participant J as Jev

  U->>CS: Sort pending invoices
  CS->>P: switch list to 50 rows
  loop each row tr#documento_<id>
    CS->>P: GET detail page (user's session)
    P-->>CS: dadosLinhasDocumento (VAT lines)
    CS->>BG: decide(invoice)
    BG->>BG: NIF cached?
    alt new merchant
      BG->>N: lookup (queued if over the hourly limit)
      N-->>BG: main CAE + activity
    end
    BG->>J: state + one "category" choice over 16 options
    J-->>BG: choice, probabilities, confidence
    BG-->>CS: decision
    alt confidence > 0.8
      CS->>P: click button[value=code] (only if its label matches)
      P-->>CS: same-sector pop-up? answer "Só esta"
    else
      CS->>CS: mark row amber, show best guess + runner-up
    end
  end
  CS->>BG: re-ask amber rows with the merchant's settled invoices
  U->>P: check amber rows, press Submeter
```

## The decision

```mermaid
flowchart TD
  A["Invoice: merchant, VAT lines, total"] --> B["Add merchant activity<br/>(nif.pt CAE + description)"]
  B --> C["Jev picks 1 of 16 categories<br/>each option is a full sentence"]
  C --> D{"Confidence > 0.8?"}
  D -- yes --> E["Green: button pressed"]
  D -- no --> F["Re-ask with this merchant's<br/>other settled invoices"]
  F --> G{"Confidence > 0.8?"}
  G -- yes --> E
  G -- no --> H["Amber: user picks<br/>(Use … button offers the best guess)"]
  E --> I["Deduction total in €<br/>(2025 IRS rates and caps)"]
  H --> I
```

- **Jev writes no text.** The option sentence it picked is the reason shown to the user.
- **The date is left out of the Jev request**, so a repeat invoice (the same monthly pass) hits the cache.
- **Confident rows are never re-asked.** The same shop can sell a meal and a loaf of bread.

## Safety rules
- **Never presses Submeter.** The user submits.
- **Fails closed:** a button is clicked only if its label matches the expected category.
- **The user's own pick always wins.** A row the user already set is skipped.
- **Clicks run one at a time** so each same-sector pop-up is answered "Só esta" (`#oneBtn`). It never presses "Todas" (`#allBtn`), and a pop-up the user opens is left for the user.
- **No invoice data leaves the browser** except the fields sent to Jev, and the merchant NIF sent to nif.pt.

## Limits
- The portal lists only the 50 most recent pending invoices, so a larger backlog takes several passes.
- nif.pt's free key allows 10 lookups an hour. New merchants queue, and their amber rows are re-decided when the lookup arrives.
- Books, arts and museums (C13–C15) add €0 to the total until their deduction rates are confirmed.
