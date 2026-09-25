# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Chrome extension, Manifest V3, vanilla JS (`extension/`). Marketing home page is a single static HTML page.

## Users
- **Portuguese IRS filer:** logs into e-Fatura every February, finds dozens of pending invoices ("faturas com informação pendente"), and clicks a category button per invoice because the portal has no bulk edit. Wants the deductions without the clicking, and wants to stay the one who submits.

## Product Purpose
e-Fatura Rescue runs on the portal's "resolver pendências" page. It reads each pending invoice, fetches its VAT lines, looks up the merchant's activity (nif.pt CAE), and asks Jev to pick one of the 16 portal categories. Above 0.8 confidence it presses the category button; below, it marks the row amber with the best guess and runner-up. The user checks amber rows and presses Submeter.

## Positioning
Competitors either suggest (Otimiza.pt: CSV upload, €5 per analysis, you still click each invoice) or apply rules you wrote yourself (Lazy eFatura, faturas-bot). Nobody decides the category and applies it in the portal. Jev (TypeSafe AI's classifier) decides; plain code fetches, looks up and narrows.

## Brand Commitments
- Name: **e-Fatura Rescue**, credited "decisions by Jev".
- Never presses Submeter. Never presses "Todas". Clicks a button only if its label matches. The user's own pick wins.
- Portal vocabulary stays in Portuguese (Submeter, pendentes, Apenas esta, Restauração, Passe público); page copy is English.

## Evidence on Hand (all from 2026-09-25, maker's own account unless noted)
- Real portal first run: 49 of 50 pending invoices filled in, 1 left amber; 7 merchants queued for nif.pt.
- Demo recording: 50/50 sorted, €248.18 shown as ready to submit. The portal banner in it reads "Foram obtidas as 50 faturas mais recentes de um total de 134 faturas pendentes" (134 pending on the maker's account).
- Mock page with the 11 pending sample invoices: 9 filled in, all correct; 2 left amber (protein bar 48% vs 47%, take-away bread 79%).
- Portal shows at most the 50 most recent pending invoices per pass. nif.pt free key: 10 lookups an hour.
- No users, testimonials, pricing or Chrome Web Store listing exist. Don't invent them.

## Assumptions (inferred from HANDOFF.md, not confirmed in an interview)
- Distribution is a developer preview (load unpacked) until a store listing exists.
