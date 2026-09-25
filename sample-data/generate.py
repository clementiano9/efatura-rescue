"""Synthetic e-Fatura sample set: portal-shaped JSON, flat CSV, AT-spec QR codes and receipt images.

Run: uv run --with "qrcode[pil]" python generate.py
"""
import csv
import json
import random
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
BUYER_NIF = "123456789"  # AT's own example NIF from the QR spec
random.seed(7)

# Codes confirmed in tuianog/faturas-bot (resolverPendenciaAdquirente.action)
AMBITO = {
    "Restauracao": "C03", "Cabeleireiro": "C04", "Saude": "C05", "Educacao": "C06",
    "Imoveis": "C07", "Lares": "C08", "Veterinario": "C09", "PassePublico": "C10",
    "Ginasios": "C11", "Jornais": "C12", "Outros": "C99",
}


def nif(prefix: str) -> str:
    """Random NIF with a valid mod-11 check digit (synthetic merchants only)."""
    base = prefix + "".join(random.choice("0123456789") for _ in range(8 - len(prefix)))
    r = sum(int(d) * w for d, w in zip(base, range(9, 1, -1))) % 11
    return base + str(0 if r < 2 else 11 - r)


# (lines) = [(vat_rate_pct, base_eur)]; vat 0 means exempt (art. 9.º CIVA)
MERCHANTS = [
    # Real chain NIFs (printed on every receipt; also in faturas-bot)
    dict(key="continente", nif="502011475", name="Modelo Continente Hipermercados", cae=["47111"], real=True),
    dict(key="pingodoce", nif="500829993", name="Pingo Doce", cae=["47111"], real=True),
    dict(key="mercadona", nif="514038942", name="Mercadona", cae=["47111"], real=True),
    dict(key="nos", nif="502604751", name="NOS Comunicações", cae=["61100"], real=True),
    # Synthetic merchants
    dict(key="farmacia", nif=nif("5"), name="Farmácia Alegria (exemplo)", cae=["47730"]),
    dict(key="dentista", nif=nif("5"), name="Clínica Dentária Sorriso (exemplo)", cae=["86230", "47782"]),
    dict(key="pastelaria", nif=nif("5"), name="Pastelaria Bica & Nata (exemplo)", cae=["10711", "56107"]),
    dict(key="tasco", nif=nif("5"), name="Restaurante O Tasco (exemplo)", cae=["56101"]),
    dict(key="ginasio", nif=nif("5"), name="FitLisboa Ginásio (exemplo)", cae=["93130", "47640"]),
    dict(key="barbearia", nif=nif("5"), name="Barbearia Alfama (exemplo)", cae=["96021", "47750"]),
    dict(key="vet", nif=nif("5"), name="Clínica Veterinária Patas (exemplo)", cae=["75000", "47760"]),
    dict(key="navegante", nif=nif("5"), name="Transportes Urbanos (exemplo)", cae=["49310"]),
    dict(key="creche", nif=nif("5"), name="Creche Pequenos Passos IPSS (exemplo)", cae=["88910", "85100"]),
    dict(key="jornal", nif=nif("5"), name="Diário de Lisboa Digital (exemplo)", cae=["58130"]),
    dict(key="lar", nif=nif("5"), name="Lar Sénior Tejo (exemplo)", cae=["87301"]),
]
M = {m["key"]: m for m in MERCHANTS}

# estado: A = already classified by AT, P = pending (buyer must choose). expected = ground truth label.
INVOICES = [
    ("continente", "2025-01-18", "FS", [(6, 42.10), (13, 6.20), (23, 18.35)], "A", "Outros",
     "Supermarket, single CAE 47111: AT auto-classifies as general household expense."),
    ("pingodoce", "2025-02-03", "FS", [(6, 23.80), (23, 9.10)], "A", "Outros", "Supermarket, general."),
    ("mercadona", "2025-03-11", "FS", [(6, 31.45), (23, 12.60)], "A", "Outros", "Supermarket, general."),
    ("nos", "2025-03-01", "FT", [(23, 36.58)], "A", "Outros", "Telecom bill, general."),
    ("farmacia", "2025-02-14", "FS", [(6, 18.40), (23, 9.99)], "P", "Saude",
     "Pharmacy: the 6% line is medicine, so it counts as health. The 23% line counts as health only with a prescription; otherwise it stays general."),
    ("farmacia", "2025-06-22", "FS", [(23, 24.50)], "P", "Outros",
     "Pharmacy but only a 23% line (cosmetics or supplements). Without a prescription this is a general expense, not health."),
    ("dentista", "2025-04-09", "FR", [(0, 85.00)], "P", "Saude",
     "Dental clinic, exempt under CIVA art. 9. Its second CAE (retail) makes AT unsure; the exempt medical act means health."),
    ("pastelaria", "2025-05-06", "FS", [(13, 3.10), (23, 1.20)], "P", "Restauracao",
     "Bakery with a café CAE. Food at 13% plus a drink at 23% means a meal eaten in, which is restaurant spending."),
    ("pastelaria", "2025-05-07", "FS", [(6, 2.40)], "P", "Outros",
     "Same bakery, but a single 6% line is bread to take away, not restaurant spending."),
    ("tasco", "2025-05-17", "FS", [(13, 21.00), (23, 6.50)], "A", "Restauracao",
     "Restaurant, single CAE 56101: AT auto-assigns restaurant spending."),
    ("ginasio", "2025-01-05", "FT", [(23, 32.52)], "P", "Ginasios",
     "Gym with a secondary retail CAE. A monthly-membership-sized amount means gym spending."),
    ("ginasio", "2025-01-19", "FS", [(23, 2.84)], "P", "Outros",
     "Same gym, small 23% purchase (protein bar). Retail, so general expense."),
    ("barbearia", "2025-03-22", "FS", [(23, 12.20)], "P", "Cabeleireiro",
     "Barber with a cosmetics-retail CAE. A haircut-sized amount means hairdresser spending."),
    ("vet", "2025-07-02", "FT", [(23, 40.65)], "P", "Veterinario",
     "Vet clinic with a pet-shop CAE, same VAT rate either way. Ambiguous: flag it and ask for the receipt."),
    ("navegante", "2025-02-01", "FR", [(6, 37.74)], "A", "PassePublico", "Monthly public-transport pass."),
    ("creche", "2025-09-30", "FT", [(0, 210.00)], "P", "Educacao",
     "Registered charity (IPSS) with a social-services CAE plus a pre-school CAE. Nursery fees count as education."),
    ("jornal", "2025-04-01", "FR", [(6, 7.54)], "A", "Jornais", "Newspaper subscription."),
    ("lar", "2025-10-31", "FT", [(0, 950.00)], "P", "Lares", "Care home for a parent (dependent), so care home spending."),
]


def cents(x: float) -> int:
    return round(x * 100)


def build():
    docs, rows = [], []
    for i, (mk, date, tipo, lines, estado, expected, why) in enumerate(INVOICES, 1):
        m = M[mk]
        series, number = f"{tipo} A{date[:4]}", 100 + i * 7
        atcud = f"{''.join(random.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))}-{number}"
        linhas = []
        for rate, base in lines:
            iva = round(base * rate / 100, 2)
            linhas.append({
                "valorBaseTributavel": cents(base), "valorIva": cents(iva), "valorTotal": cents(base + iva),
                "taxaIva": rate * 100, "tipoTaxaIva": "IVA" if rate else "ISE",
                "motivoIsencao": "M07" if rate == 0 else None,
                "taxa": {0: "ISE", 6: "RED", 13: "INT", 23: "NOR"}[rate],
                "paisTaxa": "PT", "regiaoTaxa": "1", "dataDocumento": date,
            })
        total = sum(l["valorTotal"] for l in linhas) / 100
        iva_total = sum(l["valorIva"] for l in linhas) / 100
        doc = {
            "idDocumento": 9_000_000 + i, "nifEmitente": int(m["nif"]), "nomeEmitente": m["name"],
            "tipoDocumento": tipo, "numeroDocumento": f"{series}/{number}", "atcud": atcud,
            "dataEmissaoDocumento": date, "estadoDocumento": estado,
            "ambitoAquisicao": AMBITO[expected] if estado == "A" else None,
            "valorTotal": cents(total), "valorIva": cents(iva_total), "linhas": linhas,
            "_cae": m["cae"], "_realMerchantNif": m.get("real", False),
            "_expected": {"ambito": expected, "codigo": AMBITO[expected], "why": why},
        }
        docs.append(doc)
        rows.append({
            "id": doc["idDocumento"], "data": date, "nif_emitente": m["nif"], "emitente": m["name"],
            "tipo": tipo, "numero": doc["numeroDocumento"], "estado": estado,
            "cae": "|".join(m["cae"]), "total_eur": f"{total:.2f}", "iva_eur": f"{iva_total:.2f}",
            "taxas_iva": "|".join(str(r) for r, _ in lines),
            "ambito_atual": doc["ambitoAquisicao"] or "", "ambito_esperado": AMBITO[expected],
        })
        write_receipt(doc, m, lines, qr_payload(doc, m, lines, total, iva_total))

    (OUT / "efatura_adquirente.json").write_text(json.dumps(
        {"success": True, "totalElementos": len(docs), "linhas": docs}, ensure_ascii=False, indent=2))
    with open(OUT / "efatura_flat.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys(), delimiter=";")
        w.writeheader()
        w.writerows(rows)
    (OUT / "merchants.json").write_text(json.dumps(MERCHANTS, ensure_ascii=False, indent=2))


def qr_payload(doc, m, lines, total, iva_total) -> str:
    """Fields per AT 'Especificações Técnicas Código QR' (Portaria 195/2020)."""
    by_rate = {r: b for r, b in lines}
    f = [f"A:{m['nif']}", f"B:{BUYER_NIF}", "C:PT", f"D:{doc['tipoDocumento']}", "E:N",
         f"F:{doc['dataEmissaoDocumento'].replace('-', '')}", f"G:{doc['numeroDocumento']}",
         f"H:{doc['atcud']}", "I1:PT"]
    if 0 in by_rate:
        f.append(f"I2:{by_rate[0]:.2f}")
    for rate, (kb, kv) in {6: ("I3", "I4"), 13: ("I5", "I6"), 23: ("I7", "I8")}.items():
        if rate in by_rate:
            f += [f"{kb}:{by_rate[rate]:.2f}", f"{kv}:{by_rate[rate] * rate / 100:.2f}"]
    f += [f"N:{iva_total:.2f}", f"O:{total:.2f}", "Q:" + "".join(random.choice("ABCDEFabcdef0123456789") for _ in range(4)), "R:9999"]
    return "*".join(f)


def write_receipt(doc, m, lines, payload):
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    img = Image.new("RGB", (420, 640), "white")
    d = ImageDraw.Draw(img)
    y = 16
    for text in [m["name"], f"NIF {m['nif']}", doc["numeroDocumento"],
                 f"Data {doc['dataEmissaoDocumento']}", f"NIF cliente {BUYER_NIF}", "-" * 40]:
        d.text((16, y), text, fill="black", font=font)
        y += 22
    for rate, base in lines:
        label = "Isento art.9 CIVA" if rate == 0 else f"Artigos IVA {rate}%"
        d.text((16, y), f"{label:<24}{base * (1 + rate / 100):>8.2f} EUR", fill="black", font=font)
        y += 22
    d.text((16, y + 6), f"TOTAL {doc['valorTotal'] / 100:.2f} EUR", fill="black", font=font)
    d.text((16, y + 30), f"ATCUD:{doc['atcud']}", fill="black", font=font)
    qr = qrcode.make(payload, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=5, border=2)
    img.paste(qr.get_image().resize((240, 240)), (90, 380))
    receipts = OUT / "receipts"
    receipts.mkdir(exist_ok=True)
    img.save(receipts / f"{doc['idDocumento']}_{m['key']}.png")
    (receipts / f"{doc['idDocumento']}_{m['key']}.qr.txt").write_text(payload)


if __name__ == "__main__":
    build()
    print(f"wrote {len(INVOICES)} invoices to {OUT}")
