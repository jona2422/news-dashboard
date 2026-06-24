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
    ok = total = 0
    for beat in cfg["beats"]:
        collected = {}
        for url in beat["feeds"]:
            total += 1
            try:
                src, items = parse_feed(fetch(url))
                if items:
                    ok += 1
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
                print(f"  [skip] {beat['id']:<13} <- {url}: {ex}", file=sys.stderr)

        arr = sorted(collected.values(), key=lambda x: x["ts"], reverse=True)
        arr = dedup(arr)[:PER_BEAT]
        out_beats.append({"id": beat["id"], "name": beat["name"], "items": arr})
        all_items.extend(arr)

    terms, entities = compute_trends(all_items)
    now = datetime.now(timezone.utc).isoformat()
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "news.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "beats": out_beats}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "updated": now,
            "sources_ok": ok,
            "sources_total": total,
            "beats": [{"id": b["id"], "name": b["name"], "count": len(b["items"])} for b in out_beats],
        }, f, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, "trends.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "terms": terms, "entities": entities},
                  f, ensure_ascii=False, indent=1)

    total_items = sum(len(b["items"]) for b in out_beats)
    print(f"\nnews.json: {total_items} titulares · fuentes {ok}/{total} · "
          f"{len(terms)} temas, {len(entities)} entidades")


if __name__ == "__main__":
    main()
