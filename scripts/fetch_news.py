#!/usr/bin/env python3
"""Baja titulares RSS/Atom por beat y genera data/news.json + data/meta.json.

Solo usa la libreria estandar de Python (sin dependencias, sin API keys).
Si una fuente falla, se omite y el resto continua: nunca rompe la corrida.
"""
import json
import os
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")
SOURCES = os.path.join(HERE, "sources.json")

UA = "Mozilla/5.0 (compatible; NewsDashboard/1.0; +https://github.com)"
TIMEOUT = 20          # segundos por feed
PER_BEAT = 28         # titulares maximos por seccion


class _Redirect(urllib.request.HTTPRedirectHandler):
    # urllib no sigue 308 por defecto en Python < 3.11; lo tratamos como 301.
    http_error_308 = urllib.request.HTTPRedirectHandler.http_error_301


_OPENER = urllib.request.build_opener(_Redirect)


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    })
    ctx = ssl.create_default_context()
    with _OPENER.open(req, timeout=TIMEOUT) as r:
        return r.read()


def localname(tag):
    """Nombre de etiqueta sin namespace, en minuscula."""
    return tag.rsplit("}", 1)[-1].lower()


def host(url):
    """Dominio legible de una URL (sin www.), para etiquetar fuentes caidas."""
    try:
        from urllib.parse import urlparse
        return urlparse(url).hostname.replace("www.", "")
    except Exception:
        return url


def child_text(item, names):
    for ch in item:
        if localname(ch.tag) in names:
            t = (ch.text or "").strip()
            if t:
                return t
    return ""


def item_link(item):
    """RSS usa <link>texto</link>; Atom usa <link href=...>."""
    fallback = ""
    for ch in item:
        if localname(ch.tag) != "link":
            continue
        href = ch.get("href")
        if href:
            if ch.get("rel", "alternate") in ("alternate", ""):
                return href
            fallback = fallback or href
        elif (ch.text or "").strip():
            return ch.text.strip()
    return fallback


IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)
IMG_EXT = re.compile(r'\.(jpe?g|png|webp|gif)(\?|$)', re.I)


def item_image(item):
    """Saca la imagen del item: media:content/thumbnail, enclosure o primer <img>."""
    for ch in item.iter():
        ln = localname(ch.tag)
        if ln in ("thumbnail", "content"):
            url = ch.get("url")
            if url and (ln == "thumbnail" or ch.get("medium") == "image"
                        or ch.get("type", "").startswith("image") or IMG_EXT.search(url)):
                return url
        elif ln == "enclosure":
            url = ch.get("url")
            if url and (ch.get("type", "").startswith("image") or IMG_EXT.search(url)):
                return url
    for ch in item.iter():
        if localname(ch.tag) in ("description", "encoded", "summary", "content"):
            m = IMG_RE.search(ch.text or "")
            if m:
                return m.group(1)
    return ""


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:  # RFC 822 (RSS pubDate)
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:  # ISO 8601 (Atom)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


DATE_TAGS = {"pubdate", "published", "updated", "date"}


def parse_feed(raw):
    """Devuelve (nombre_fuente, [{title, link, dt, image}, ...]).

    Generico: cubre RSS 2.0, RSS 1.0/RDF y Atom ignorando namespaces.
    """
    items = []
    source = ""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return source, items

    # Titulo de la fuente: preferir el de <channel>/<feed>.
    for el in root.iter():
        if localname(el.tag) in ("channel", "feed"):
            for ch in el:
                if localname(ch.tag) == "title" and (ch.text or "").strip():
                    source = ch.text.strip()
                    break
        if source:
            break
    if not source:
        source = child_text(root, {"title"})

    for el in root.iter():
        if localname(el.tag) not in ("item", "entry"):
            continue
        title = child_text(el, {"title"})
        link = item_link(el)
        if title and link:
            items.append({"title": title, "link": link,
                          "dt": parse_date(child_text(el, DATE_TAGS)),
                          "image": item_image(el)})
    return source, items


# --------------------------------------------------------------------------- #
# Geografia de las noticias: paises detectados en los titulares.
# (nombre en el mapa ECharts, nombre en espanol, lat, lon, alias EN|ES|capitales)
# Los alias en MAYUSCULAS se comparan respetando mayusculas (US, UK, UAE...).
COUNTRIES = [
    ("United States", "Estados Unidos", 39.8, -98.6, "United States|Estados Unidos|EEUU|USA|US|America|Washington|White House|Casa Blanca"),
    ("China", "China", 35.9, 104.2, "China|Beijing|Pekín|Pekin|Shanghai|Hong Kong|Xi Jinping"),
    ("Russia", "Rusia", 61.5, 105.3, "Russia|Rusia|Moscow|Moscú|Kremlin|Putin"),
    ("Ukraine", "Ucrania", 48.4, 31.2, "Ukraine|Ucrania|Kyiv|Kiev|Zelensky|Zelenski"),
    ("Israel", "Israel", 31.0, 34.9, "Israel|Tel Aviv|Jerusalem|Jerusalén|Netanyahu"),
    ("Palestine", "Palestina", 31.9, 35.2, "Palestine|Palestina|Gaza|West Bank|Cisjordania|Hamas|Hamás"),
    ("Iran", "Irán", 32.4, 53.7, "Iran|Irán|Tehran|Teherán"),
    ("Iraq", "Irak", 33.2, 43.7, "Iraq|Irak|Baghdad|Bagdad"),
    ("Syria", "Siria", 34.8, 39.0, "Syria|Siria|Damascus|Damasco"),
    ("Lebanon", "Líbano", 33.9, 35.9, "Lebanon|Líbano|Libano|Beirut|Hezbollah|Hezbolá"),
    ("Yemen", "Yemen", 15.6, 48.0, "Yemen|Houthi|Houthis|hutíes"),
    ("Saudi Arabia", "Arabia Saudita", 23.9, 45.1, "Saudi Arabia|Arabia Saudita|Arabia Saudí|Riyadh|Riad"),
    ("United Arab Emirates", "Emiratos Árabes", 23.4, 53.8, "United Arab Emirates|Emiratos Árabes|UAE|Dubai|Dubái|Abu Dhabi"),
    ("Qatar", "Catar", 25.3, 51.2, "Qatar|Catar|Doha"),
    ("Turkey", "Turquía", 38.9, 35.2, "Turkey|Turquía|Turquia|Ankara|Istanbul|Estambul|Erdogan"),
    ("Egypt", "Egipto", 26.8, 30.8, "Egypt|Egipto|Cairo|El Cairo"),
    ("Jordan", "Jordania", 30.6, 36.2, "Jordania|Amman|Ammán"),
    ("Afghanistan", "Afganistán", 33.9, 67.7, "Afghanistan|Afganistán|Afganistan|Kabul|Taliban|talibanes"),
    ("Pakistan", "Pakistán", 30.4, 69.3, "Pakistan|Pakistán|Islamabad|Karachi"),
    ("India", "India", 20.6, 79.0, "India|New Delhi|Nueva Delhi|Mumbai|Modi"),
    ("Bangladesh", "Bangladés", 23.7, 90.4, "Bangladesh|Bangladés|Dhaka|Daca"),
    ("Myanmar", "Birmania", 21.9, 95.9, "Myanmar|Birmania|Yangon|Rangún"),
    ("Thailand", "Tailandia", 15.9, 100.9, "Thailand|Tailandia|Bangkok"),
    ("Vietnam", "Vietnam", 14.1, 108.3, "Vietnam|Hanoi|Hanói"),
    ("Philippines", "Filipinas", 12.9, 121.8, "Philippines|Filipinas|Manila"),
    ("Indonesia", "Indonesia", -0.8, 113.9, "Indonesia|Jakarta|Yakarta|Bali"),
    ("Malaysia", "Malasia", 4.2, 102.0, "Malaysia|Malasia|Kuala Lumpur"),
    ("Singapore", "Singapur", 1.35, 103.8, "Singapore|Singapur"),
    ("Japan", "Japón", 36.2, 138.3, "Japan|Japón|Japon|Tokyo|Tokio"),
    ("Korea", "Corea del Sur", 35.9, 127.8, "South Korea|Corea del Sur|Seoul|Seúl"),
    ("Dem. Rep. Korea", "Corea del Norte", 40.3, 127.5, "North Korea|Corea del Norte|Pyongyang|Kim Jong"),
    ("Mongolia", "Mongolia", 46.9, 103.8, "Mongolia|Ulaanbaatar"),
    ("Kazakhstan", "Kazajistán", 48.0, 66.9, "Kazakhstan|Kazajistán|Kazajistan"),
    ("Australia", "Australia", -25.3, 133.8, "Australia|Sydney|Sídney|Canberra|Melbourne"),
    ("New Zealand", "Nueva Zelanda", -40.9, 174.9, "New Zealand|Nueva Zelanda|Auckland|Wellington"),
    ("United Kingdom", "Reino Unido", 55.4, -3.4, "United Kingdom|Reino Unido|Britain|Gran Bretaña|UK|England|Inglaterra|Scotland|Escocia|Wales|Gales|London|Londres"),
    ("Ireland", "Irlanda", 53.4, -8.2, "Ireland|Irlanda|Dublin|Dublín"),
    ("France", "Francia", 46.2, 2.2, "France|Francia|Paris|París|Macron"),
    ("Germany", "Alemania", 51.2, 10.5, "Germany|Alemania|Berlin|Berlín|Munich|Múnich"),
    ("Spain", "España", 40.5, -3.7, "Spain|España|Espana|Madrid|Barcelona"),
    ("Portugal", "Portugal", 39.4, -8.2, "Portugal|Lisbon|Lisboa"),
    ("Italy", "Italia", 41.9, 12.6, "Italy|Italia|Rome|Roma|Milan|Milán|Vatican|Vaticano"),
    ("Greece", "Grecia", 39.1, 21.8, "Greece|Grecia|Athens|Atenas"),
    ("Netherlands", "Países Bajos", 52.1, 5.3, "Netherlands|Países Bajos|Holanda|Amsterdam|Ámsterdam|The Hague|La Haya"),
    ("Belgium", "Bélgica", 50.5, 4.5, "Belgium|Bélgica|Belgica|Brussels|Bruselas"),
    ("Switzerland", "Suiza", 46.8, 8.2, "Switzerland|Suiza|Geneva|Ginebra|Zurich|Zúrich"),
    ("Austria", "Austria", 47.5, 14.6, "Austria|Vienna|Viena"),
    ("Poland", "Polonia", 51.9, 19.1, "Poland|Polonia|Warsaw|Varsovia"),
    ("Czech Rep.", "Chequia", 49.8, 15.5, "Czech|Chequia|República Checa|Prague|Praga"),
    ("Hungary", "Hungría", 47.2, 19.5, "Hungary|Hungría|Hungria|Budapest|Orban|Orbán"),
    ("Romania", "Rumania", 45.9, 25.0, "Romania|Rumania|Rumanía|Bucharest|Bucarest"),
    ("Serbia", "Serbia", 44.0, 21.0, "Serbia|Belgrade|Belgrado"),
    ("Sweden", "Suecia", 60.1, 18.6, "Sweden|Suecia|Stockholm|Estocolmo"),
    ("Norway", "Noruega", 60.5, 8.5, "Norway|Noruega|Oslo"),
    ("Denmark", "Dinamarca", 56.3, 9.5, "Denmark|Dinamarca|Copenhagen|Copenhague"),
    ("Finland", "Finlandia", 61.9, 25.7, "Finland|Finlandia|Helsinki"),
    ("Iceland", "Islandia", 64.9, -19.0, "Iceland|Islandia|Reykjavik"),
    ("Greenland", "Groenlandia", 71.7, -42.6, "Greenland|Groenlandia|Nuuk"),
    ("Belarus", "Bielorrusia", 53.7, 27.9, "Belarus|Bielorrusia|Minsk"),
    ("Georgia", "Georgia", 42.3, 43.4, "Tbilisi"),
    ("Armenia", "Armenia", 40.1, 45.0, "Armenia|Yerevan|Ereván"),
    ("Azerbaijan", "Azerbaiyán", 40.1, 47.6, "Azerbaijan|Azerbaiyán|Baku|Bakú"),
    ("Canada", "Canadá", 56.1, -106.3, "Canada|Canadá|Ottawa|Toronto|Trudeau"),
    ("Mexico", "México", 23.6, -102.6, "Mexico|México|Mejico|CDMX|Sheinbaum"),
    ("Guatemala", "Guatemala", 15.8, -90.2, "Guatemala"),
    ("Belize", "Belice", 17.2, -88.5, "Belize|Belice"),
    ("Honduras", "Honduras", 15.2, -86.2, "Honduras|Tegucigalpa"),
    ("El Salvador", "El Salvador", 13.8, -88.9, "El Salvador|Bukele|San Salvador"),
    ("Nicaragua", "Nicaragua", 12.9, -85.2, "Nicaragua|Managua|Ortega"),
    ("Costa Rica", "Costa Rica", 9.7, -83.8, "Costa Rica|San José de Costa Rica"),
    ("Panama", "Panamá", 8.5, -80.8, "Panama|Panamá|Canal de Panamá|Panama Canal|Mulino|Colón|Chiriquí|Darién|Darien"),
    ("Cuba", "Cuba", 21.5, -77.8, "Cuba|Havana|La Habana"),
    ("Haiti", "Haití", 19.0, -72.3, "Haiti|Haití|Port-au-Prince|Puerto Príncipe"),
    ("Dominican Rep.", "Rep. Dominicana", 18.7, -70.2, "Dominican Republic|República Dominicana|Santo Domingo|dominicano|dominicana"),
    ("Jamaica", "Jamaica", 18.1, -77.3, "Jamaica|Kingston"),
    ("Puerto Rico", "Puerto Rico", 18.2, -66.5, "Puerto Rico|San Juan de Puerto Rico|boricua"),
    ("Colombia", "Colombia", 4.6, -74.3, "Colombia|Bogotá|Bogota|Medellín|Medellin|Petro"),
    ("Venezuela", "Venezuela", 6.4, -66.6, "Venezuela|Caracas|Maduro"),
    ("Ecuador", "Ecuador", -1.8, -78.2, "Ecuador|Quito|Guayaquil|Noboa"),
    ("Peru", "Perú", -9.2, -75.0, "Peru|Perú|Lima|Machu Picchu"),
    ("Bolivia", "Bolivia", -16.3, -63.6, "Bolivia|La Paz de Bolivia|Sucre"),
    ("Brazil", "Brasil", -14.2, -51.9, "Brazil|Brasil|Brasilia|Río de Janeiro|Rio de Janeiro|São Paulo|Sao Paulo|Lula"),
    ("Paraguay", "Paraguay", -23.4, -58.4, "Paraguay|Asunción|Asuncion"),
    ("Uruguay", "Uruguay", -32.5, -55.8, "Uruguay|Montevideo"),
    ("Argentina", "Argentina", -38.4, -63.6, "Argentina|Buenos Aires|Milei"),
    ("Chile", "Chile", -35.7, -71.5, "Chile|Santiago de Chile|Valparaíso|Boric"),
    ("Guyana", "Guyana", 4.9, -58.9, "Guyana|Georgetown"),
    ("Suriname", "Surinam", 3.9, -56.0, "Suriname|Surinam"),
    ("Trinidad and Tobago", "Trinidad y Tobago", 10.7, -61.2, "Trinidad and Tobago|Trinidad y Tobago"),
    ("Morocco", "Marruecos", 31.8, -7.1, "Morocco|Marruecos|Rabat|Casablanca"),
    ("Algeria", "Argelia", 28.0, 1.7, "Algeria|Argelia|Algiers|Argel"),
    ("Tunisia", "Túnez", 33.9, 9.6, "Tunisia|Túnez|Tunez"),
    ("Libya", "Libia", 26.3, 17.2, "Libya|Libia|Tripoli|Trípoli"),
    ("Sudan", "Sudán", 12.9, 30.2, "Sudan|Sudán|Khartoum|Jartum"),
    ("S. Sudan", "Sudán del Sur", 6.9, 31.3, "South Sudan|Sudán del Sur|Juba"),
    ("Ethiopia", "Etiopía", 9.1, 40.5, "Ethiopia|Etiopía|Etiopia|Addis Ababa|Adís Abeba"),
    ("Somalia", "Somalia", 5.2, 46.2, "Somalia|Mogadishu|Mogadiscio"),
    ("Kenya", "Kenia", -0.02, 37.9, "Kenya|Kenia|Nairobi"),
    ("Tanzania", "Tanzania", -6.4, 34.9, "Tanzania|Dar es Salaam"),
    ("Uganda", "Uganda", 1.4, 32.3, "Uganda|Kampala"),
    ("Rwanda", "Ruanda", -1.9, 29.9, "Rwanda|Ruanda|Kigali"),
    ("Dem. Rep. Congo", "RD Congo", -4.0, 21.8, "DR Congo|RD Congo|Congo|Kinshasa"),
    ("Nigeria", "Nigeria", 9.1, 8.7, "Nigeria|Lagos|Abuja"),
    ("Ghana", "Ghana", 7.9, -1.0, "Ghana|Accra"),
    ("Senegal", "Senegal", 14.5, -14.5, "Senegal|Dakar"),
    ("Mali", "Malí", 17.6, -4.0, "Malí|Bamako"),
    ("Niger", "Níger", 17.6, 8.1, "Níger|Niamey"),
    ("Chad", "Chad", 15.5, 18.7, "Chad|N'Djamena"),
    ("South Africa", "Sudáfrica", -30.6, 22.9, "South Africa|Sudáfrica|Sudafrica|Johannesburg|Johannesburgo|Cape Town|Ciudad del Cabo"),
    ("Zimbabwe", "Zimbabue", -19.0, 29.2, "Zimbabwe|Zimbabue|Harare"),
    ("Mozambique", "Mozambique", -18.7, 35.5, "Mozambique|Maputo"),
    ("Madagascar", "Madagascar", -18.8, 47.0, "Madagascar|Antananarivo"),
]

_ACRO = re.compile(r"\b(EE\.\s?UU\.|U\.S\.A\.|U\.S\.|U\.K\.)")
_ACRO_MAP = {"U.S.": "US", "U.S.A.": "USA", "U.K.": "UK"}


def _country_patterns():
    pats = []
    for name, es, lat, lon, aliases in COUNTRIES:
        ci, cs = [], []
        for a in aliases.split("|"):
            if not a:
                continue
            (cs if a.isupper() and len(a) <= 5 else ci).append(re.escape(a))
        rx_ci = re.compile(r"\b(?:" + "|".join(ci) + r")\b", re.I | re.U) if ci else None
        rx_cs = re.compile(r"\b(?:" + "|".join(cs) + r")\b") if cs else None
        pats.append({"name": name, "es": es, "lat": lat, "lon": lon,
                     "ci": rx_ci, "cs": rx_cs})
    return pats


# Las alertas automaticas (GDACS/USGS) nombran paises pero inflarian el mapa;
# los sismos ya tienen su propio mapa.
ALERT_RE = re.compile(r"gdacs|usgs|earthquake alert|reliefweb", re.I)


def compute_geo(beats):
    """Cuenta menciones de paises en titulares -> data/geo.json."""
    pats = _country_patterns()
    hits = {}
    for b in beats:
        for it in b["items"]:
            if ALERT_RE.search(it.get("source") or ""):
                continue
            title = _ACRO.sub(lambda m: _ACRO_MAP.get(m.group(1).replace(" ", ""),
                                                      "EEUU"), it["title"])
            for p in pats:
                if (p["ci"] and p["ci"].search(title)) or (p["cs"] and p["cs"].search(title)):
                    c = hits.setdefault(p["name"], {
                        "name": p["name"], "es": p["es"],
                        "lat": p["lat"], "lon": p["lon"],
                        "count": 0, "items": [],
                    })
                    c["count"] += 1
                    c["items"].append({
                        "title": it["title"], "link": it["link"],
                        "source": it["source"], "image": it.get("image", ""),
                        "ts": it["ts"], "beat": b["id"], "beatName": b["name"],
                    })
    out = sorted(hits.values(), key=lambda c: c["count"], reverse=True)
    for c in out:
        c["items"].sort(key=lambda x: x["ts"], reverse=True)
        c["items"] = c["items"][:10]
    return out


# Palabras vacias (EN + ES) para el analisis estadistico de temas.
STOP = set("""
the and for with that this from have has had are was were will would could should
not but you your its his her they them their what when where who how why now out one
two over after before more most into about against amid says say said than then off via
per top get gets got can may also new news report reports update live watch video photos
opinion review first best like just back set under between during while which been being
amE Im de la el en y los las una uno por con para que del como mas pero sus este esta esto
entre sobre desde hasta porque cuando donde tras ante segun muy ano anos dia dias tiene
hace sera fue han tambien ser son una unas unos ese esa eso aqui alli aun cada
""".split())


def tokens(title):
    t = re.sub(r"[^0-9A-Za-zÁÉÍÓÚÑáéíóúñü ]", " ", title.lower())
    return {w for w in t.split() if len(w) > 3 and w not in STOP}


def dedup(items):
    """Une titulares casi iguales (misma noticia en varias fuentes).

    Mantiene el mas reciente y cuenta cuantas fuentes la traen (campo 'count').
    """
    kept = []
    for it in items:
        sig = tokens(it["title"])
        it["count"] = 1
        merged = False
        for k in kept:
            ksig = k["_sig"]
            if not sig or not ksig:
                continue
            jac = len(sig & ksig) / len(sig | ksig)
            if jac >= 0.6:
                k["count"] += 1
                if it["ts"] > k["ts"]:           # conserva el mas fresco
                    sig_keep = k["_sig"]
                    cnt = k["count"]
                    k.update(it)
                    k["_sig"] = sig_keep
                    k["count"] = cnt
                merged = True
                break
        if not merged:
            it["_sig"] = sig
            kept.append(it)
    for k in kept:
        k.pop("_sig", None)
    return kept


def compute_trends(all_items):
    """Temas calientes por frecuencia: terminos y entidades (sin IA)."""
    words, ents = Counter(), Counter()
    for it in all_items:
        title = it["title"]
        for w in re.sub(r"[^0-9A-Za-zÁÉÍÓÚÑáéíóúñü ]", " ", title).split():
            lw = w.lower()
            if len(lw) > 3 and lw not in STOP:
                words[lw] += 1
        for m in re.finditer(r"\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)*)", title):
            name = m.group(1).strip()
            if len(name) > 3 and name.lower() not in STOP and not name.isupper():
                ents[name] += 1
    return (
        [{"term": t, "count": c} for t, c in words.most_common(30) if c > 1],
        [{"name": n, "count": c} for n, c in ents.most_common(24) if c > 1],
    )


def main():
    with open(SOURCES, encoding="utf-8") as f:
        cfg = json.load(f)

    out_beats = []
    all_items = []
    feeds_health = []
    ok = total = 0
    for beat in cfg["beats"]:
        collected = {}
        for url in beat["feeds"]:
            total += 1
            try:
                src, items = parse_feed(fetch(url))
                if items:
                    ok += 1
                feeds_health.append({
                    "beat": beat["id"], "url": url,
                    "source": src or host(url),
                    "ok": bool(items), "count": len(items),
                    "error": "" if items else "sin items",
                })
                for it in items:
                    if it["link"] in collected:
                        continue
                    dt = it["dt"]
                    collected[it["link"]] = {
                        "title": it["title"],
                        "link": it["link"],
                        "source": src or beat["name"],
                        "image": it["image"],
                        "published": dt.isoformat() if dt else None,
                        "ts": int(dt.timestamp() * 1000) if dt else 0,
                    }
                print(f"  [ok]   {beat['id']:<13} <- {url} ({len(items)})")
            except Exception as ex:
                feeds_health.append({
                    "beat": beat["id"], "url": url, "source": host(url),
                    "ok": False, "count": 0, "error": str(ex)[:120],
                })
                print(f"  [skip] {beat['id']:<13} <- {url}: {ex}", file=sys.stderr)

        arr = sorted(collected.values(), key=lambda x: x["ts"], reverse=True)
        arr = dedup(arr)[:PER_BEAT]
        out_beats.append({"id": beat["id"], "name": beat["name"], "items": arr})
        all_items.extend(arr)

    terms, entities = compute_trends(all_items)
    geo = compute_geo(out_beats)
    now = datetime.now(timezone.utc).isoformat()
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "geo.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "total": sum(c["count"] for c in geo),
                   "countries": geo}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, "news.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "beats": out_beats}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "updated": now,
            "sources_ok": ok,
            "sources_total": total,
            "beats": [{"id": b["id"], "name": b["name"], "count": len(b["items"])} for b in out_beats],
            "feeds": sorted(feeds_health, key=lambda x: (x["ok"], x["beat"])),
        }, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, "trends.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "terms": terms, "entities": entities},
                  f, ensure_ascii=False, indent=1)

    total_items = sum(len(b["items"]) for b in out_beats)
    print(f"\nnews.json: {total_items} titulares · fuentes {ok}/{total} · "
          f"{len(terms)} temas, {len(entities)} entidades · "
          f"{len(geo)} países en el mapa")


if __name__ == "__main__":
    main()
