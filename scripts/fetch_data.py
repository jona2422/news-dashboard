#!/usr/bin/env python3
"""Datos para graficas (todo gratis, sin API keys):

  - Sismos en vivo .......... USGS GeoJSON (ultimas 24h)
  - Mercados & divisas ...... Stooq (CSV)
  - Indicadores globales .... API del Banco Mundial

Cada bloque esta aislado en try/except: si una fuente falla, las demas siguen.
Solo libreria estandar de Python.
"""
import json
import os
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = "Mozilla/5.0 (compatible; NewsDashboard/1.0)"
TIMEOUT = 25


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
        return r.read()


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# --------------------------------------------------------------------------- #
def quakes():
    url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
    d = json.loads(get(url))
    items = []
    for ft in d.get("features", []):
        p = ft.get("properties", {})
        c = ft.get("geometry", {}).get("coordinates", [None, None, None])
        mag = p.get("mag")
        if mag is None or c[0] is None:
            continue
        items.append({
            "mag": round(mag, 1),
            "place": p.get("place", ""),
            "time": p.get("time"),
            "lon": c[0], "lat": c[1], "depth": c[2],
            "url": p.get("url", ""),
        })
    items.sort(key=lambda x: x["mag"] or 0, reverse=True)
    mx = max((i["mag"] for i in items), default=0)
    save("quakes.json", {"updated": now_iso(), "count": len(items), "max": mx, "items": items[:300]})
    print(f"quakes: {len(items)} eventos (max M{mx})")


# --------------------------------------------------------------------------- #
def _tile(out, label, vals, fmt):
    """Agrega un instrumento con precio, cambio diario y sparkline."""
    if len(vals) < 2:
        return
    price, prev = vals[-1], vals[-2]
    out.append({
        "symbol": label, "label": label,
        "price": round(price, fmt),
        "change": round(price - prev, fmt),
        "changePct": round((price - prev) / prev * 100, 2) if prev else 0,
        "spark": [round(x, fmt) for x in vals[-30:]],
    })


def markets():
    """Divisas (Frankfurter/BCE) + cripto (CoinGecko) + spot regional (er-api).

    Todas las fuentes son keyless y funcionan desde IPs de datacenter (Actions).
    """
    out = []

    # ---- Divisas con historico (Banco Central Europeo via Frankfurter) ----
    try:
        d2 = datetime.now(timezone.utc).date()
        d1 = d2 - timedelta(days=50)
        url = f"https://api.frankfurter.app/{d1}..{d2}?from=USD&to=EUR,GBP,JPY,CNY,MXN,BRL"
        rates = json.loads(get(url))["rates"]
        dates = sorted(rates.keys())

        def pair(cur, invert=False, label="", fmt=4):
            vals = []
            for d in dates:
                v = rates[d].get(cur)
                if v:
                    vals.append(1.0 / v if invert else v)
            _tile(out, label, vals, fmt)

        pair("EUR", invert=True, label="EUR/USD", fmt=4)
        pair("GBP", invert=True, label="GBP/USD", fmt=4)
        pair("JPY", label="USD/JPY", fmt=2)
        pair("CNY", label="USD/CNY", fmt=4)
        pair("MXN", label="USD/MXN", fmt=3)
        pair("BRL", label="USD/BRL", fmt=3)
        print(f"  [ok]   divisas: {len(out)} pares")
    except Exception as ex:
        print(f"  [skip] divisas: {ex}", file=sys.stderr)

    # ---- Cripto (CoinGecko) ----
    for coin, label in (("bitcoin", "Bitcoin"), ("ethereum", "Ethereum")):
        try:
            url = (f"https://api.coingecko.com/api/v3/coins/{coin}/market_chart"
                   f"?vs_currency=usd&days=30&interval=daily")
            prices = [p[1] for p in json.loads(get(url)).get("prices", [])]
            before = len(out)
            _tile(out, label, prices, 0)
            if len(out) > before:
                print(f"  [ok]   {label}: {out[-1]['price']}")
        except Exception as ex:
            print(f"  [skip] {label}: {ex}", file=sys.stderr)

    # ---- Spot regional: peso colombiano (vecino; Panamá es dolarizado) ----
    try:
        r = json.loads(get("https://open.er-api.com/v6/latest/USD")).get("rates", {})
        if r.get("COP"):
            out.append({"symbol": "USD/COP", "label": "USD/COP",
                        "price": round(r["COP"], 2), "change": 0, "changePct": 0, "spark": []})
            print(f"  [ok]   USD/COP: {round(r['COP'], 2)}")
    except Exception as ex:
        print(f"  [skip] USD/COP: {ex}", file=sys.stderr)

    save("markets.json", {"updated": now_iso(), "items": out})
    print(f"markets: {len(out)} instrumentos")


# --------------------------------------------------------------------------- #
WB_COUNTRIES = [("WLD", "Mundo"), ("USA", "EE.UU."), ("CHN", "China"), ("PAN", "Panamá")]
WB_INDICATORS = [
    ("FP.CPI.TOTL.ZG", "Inflación anual (%)"),
    ("NY.GDP.MKTP.KD.ZG", "Crecimiento PIB (%)"),
]


def indicators():
    series = []
    for code, label in WB_INDICATORS:
        countries = []
        for cc, cname in WB_COUNTRIES:
            try:
                url = (f"https://api.worldbank.org/v2/country/{cc}/indicator/{code}"
                       f"?format=json&per_page=20&date=2010:2024")
                d = json.loads(get(url))
                pts = []
                if isinstance(d, list) and len(d) > 1 and d[1]:
                    for row in d[1]:
                        if row.get("value") is not None:
                            pts.append({"year": int(row["date"]), "value": round(row["value"], 2)})
                pts.sort(key=lambda x: x["year"])
                if pts:
                    countries.append({"code": cc, "name": cname, "points": pts})
            except Exception as ex:
                print(f"  [skip] WB {code}/{cc}: {ex}", file=sys.stderr)
        if countries:
            series.append({"indicator": code, "label": label, "countries": countries})
            print(f"  [ok]   indicador {label}: {len(countries)} paises")
    save("indicators.json", {"updated": now_iso(), "series": series})
    print(f"indicators: {len(series)} series")


# --------------------------------------------------------------------------- #
HISTORY_MAX = 1000  # ~6 semanas corriendo cada hora


def _read(name):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def history():
    """Acumula un snapshot por corrida para graficar tendencias en el tiempo."""
    meta = _read("meta.json")
    q = _read("quakes.json")
    mk = _read("markets.json")
    btc = next((i["price"] for i in mk.get("items", []) if i.get("label") == "Bitcoin"), None)

    rec = {
        "t": int(datetime.now(timezone.utc).timestamp() * 1000),
        "beats": {b["id"]: b["count"] for b in meta.get("beats", [])},
        "news_total": sum(b["count"] for b in meta.get("beats", [])),
        "quake_max": q.get("max", 0),
        "quake_count": q.get("count", 0),
        "btc": btc,
    }
    hist = _read("history.json")
    records = hist.get("records", []) if isinstance(hist, dict) else []
    records.append(rec)
    records = records[-HISTORY_MAX:]
    save("history.json", {"updated": now_iso(), "records": records})
    print(f"history: {len(records)} snapshots")


def main():
    for fn in (quakes, markets, indicators, history):
        try:
            fn()
        except Exception as ex:
            print(f"[error] {fn.__name__}: {ex}", file=sys.stderr)


if __name__ == "__main__":
    main()
