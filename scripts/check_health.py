#!/usr/bin/env python3
"""Vigila la salud de las fuentes y avisa cuando una lleva mucho tiempo caida.

Lee data/meta.json (lo deja fetch_news.py) y mantiene data/health.json con una
racha de fallos consecutivos por feed. Un 403 suelto o un timeout no molestan a
nadie: solo se avisa cuando un feed acumula FALLOS_PARA_AVISAR corridas seguidas
sin responder, o cuando una seccion entera se queda sin titulares.

Si hay algo que avisar, escribe el aviso en GITHUB_OUTPUT (alert=1 + body) para
que el workflow abra un issue. Solo usa la biblioteca estandar.
"""
import json
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
META = os.path.join(DATA, "meta.json")
HEALTH = os.path.join(DATA, "health.json")

FALLOS_PARA_AVISAR = 6      # corridas seguidas caido (= ~6 horas) antes de avisar
REPETIR_AVISO_DIAS = 7      # no repetir el mismo aviso antes de esto


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def main():
    meta = load(META, None)
    if not meta:
        print("No hay meta.json; nada que revisar.")
        return

    health = load(HEALTH, {})
    streaks = health.get("streaks", {})
    alerted = health.get("alerted", {})
    now = datetime.now(timezone.utc)

    nuevos = []

    for feed in meta.get("feeds", []):
        url = feed.get("url") or feed.get("name")
        if not url:
            continue
        if feed.get("ok"):
            streaks.pop(url, None)
            alerted.pop(url, None)
            continue

        streaks[url] = streaks.get(url, 0) + 1
        if streaks[url] < FALLOS_PARA_AVISAR:
            continue

        previo = alerted.get(url)
        if previo:
            try:
                if now - datetime.fromisoformat(previo) < timedelta(days=REPETIR_AVISO_DIAS):
                    continue
            except ValueError:
                pass

        alerted[url] = now.isoformat()
        nuevos.append("- **%s** (`%s`) lleva %d corridas caido: %s" % (
            feed.get("beat", "?"), url, streaks[url], str(feed.get("error"))[:120]))

    # Una seccion sin titulares es un fallo silencioso aunque los feeds respondan.
    for beat in meta.get("beats", []):
        if beat.get("count", 0) == 0:
            clave = "beat:" + beat["id"]
            previo = alerted.get(clave)
            if previo:
                try:
                    if now - datetime.fromisoformat(previo) < timedelta(days=REPETIR_AVISO_DIAS):
                        continue
                except ValueError:
                    pass
            alerted[clave] = now.isoformat()
            nuevos.append("- La seccion **%s** se quedo sin titulares." % beat.get("name", beat["id"]))

    # Un feed que se saca de sources.json no debe seguir arrastrando su racha.
    vigentes = {f.get("url") for f in meta.get("feeds", [])}
    vigentes |= {"beat:" + b["id"] for b in meta.get("beats", [])}
    streaks = {k: v for k, v in streaks.items() if k in vigentes}
    alerted = {k: v for k, v in alerted.items() if k in vigentes}

    health = {"streaks": streaks, "alerted": alerted, "checked": now.isoformat()}
    with open(HEALTH, "w", encoding="utf-8") as f:
        json.dump(health, f, ensure_ascii=False, indent=1)

    ok = meta.get("sources_ok", 0)
    total = meta.get("sources_total", 0)
    print("Salud: %s/%s fuentes ok, %d aviso(s) nuevo(s)." % (ok, total, len(nuevos)))

    out = os.environ.get("GITHUB_OUTPUT")
    if not (nuevos and out):
        return

    cuerpo = (
        "@jona2422 el NEWSDESK tiene fuentes caidas.\n\n"
        + "\n".join(nuevos)
        + "\n\nEstado actual: **%s/%s** fuentes respondiendo.\n" % (ok, total)
        + "\nSuele arreglarse cambiando el feed en `scripts/sources.json`, "
        + "o ajustando el User-Agent en `scripts/fetch_news.py` si es un 403.\n"
    )
    with open(out, "a", encoding="utf-8") as f:
        f.write("alert=1\n")
        f.write("body<<FIN_DEL_CUERPO\n%s\nFIN_DEL_CUERPO\n" % cuerpo)


if __name__ == "__main__":
    main()
