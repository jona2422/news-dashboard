#!/usr/bin/env python3
"""Prueba temporal: que feeds responden desde una IP de datacenter de GitHub.

Varios medios bloquean por IP/ASN, no por User-Agent, asi que un feed que
funciona desde casa puede fallar aqui. Este script existe solo para decidir
reemplazos; se borra despues.
"""
import re
import urllib.request

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

CANDIDATOS = [
    ("MO timesofisrael(control)", "https://www.timesofisrael.com/feed/"),
    ("MO aljazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
    ("MO jpost", "https://www.jpost.com/rss/rssfeedsfrontpage.aspx"),
    ("MO al-monitor", "https://www.al-monitor.com/rss"),
    ("MO arabnews", "https://www.arabnews.com/rss.xml"),
    ("MO gnews-toi", "https://news.google.com/rss/search?q=site:timesofisrael.com&hl=en-US&gl=US&ceid=US:en"),
    ("DIS reliefweb-disasters(control)", "https://reliefweb.int/disasters/rss.xml"),
    ("DIS reliefweb-updates", "https://reliefweb.int/updates/rss.xml"),
    ("DIS gnews-reliefweb", "https://news.google.com/rss/search?q=site:reliefweb.int&hl=en-US&gl=US&ceid=US:en"),
    ("DIS ifrc", "https://www.ifrc.org/rss.xml"),
    ("DIS nasa-hazards", "https://earthobservatory.nasa.gov/feeds/natural-hazards.rss"),
    ("DIS unocha", "https://www.unocha.org/rss.xml"),
]


def main():
    for nombre, url in CANDIDATOS:
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/rss+xml, application/atom+xml, application/xml, */*",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=25) as r:
                cuerpo = r.read()
            items = len(re.findall(rb"<item[ >]|<entry[ >]", cuerpo))
            print("%-34s %s  %7d bytes  items:%d" % (nombre, r.status, len(cuerpo), items))
        except Exception as e:
            print("%-34s ERR  %s" % (nombre, str(e)[:70]))


if __name__ == "__main__":
    main()
