# NEWSDESK — Portal de noticias de Jonathan

Dashboard personal tipo *terminal* (Bloomberg-style) que reúne, en un solo lugar,
los temas que me interesan, con datos en tiempo real y gráficas de seguimiento global.

**Funciona como una pequeña redacción** con secciones (beats):
Música & Industria · Arte/Cultura/Educación · Tecnología & IA · Actualidad Global ·
Panamá/LatAm · Desastres Naturales · Medio Oriente · China.

Incluye además:
- 📰 **Portada "Lo más importante"** — reúne los titulares con mayor cobertura (cuántas
  fuentes los traen) + recencia, de todas las secciones. Filtra alertas automáticas
  (sismos/GDACS) para que no la inunden.
- 🌦️ **Clima de Panamá** — actual + pronóstico de 4 días (Open-Meteo, sin API key).
- 🩺 **Salud de fuentes** — indicador en el pie con cuántos feeds responden y cuáles fallan.
- 🖼️ **Titulares con miniatura** (imagen extraída del propio feed).
- 🔎 **Buscador y filtros** en vivo (texto, fuente, últimas 24 h / 7 días).
- 🔥 **Temas calientes** — análisis estadístico (sin IA) de los términos y entidades más
  mencionados; además **deduplica** la misma noticia repetida entre fuentes (badge ▣ N).
- ⭐ **Personal y persistente** (localStorage): marca leídos, **guarda** favoritos, badge de
  **"nuevas desde tu última visita"** y oculta secciones que no te interesan.
- 🌍 **Mapa de sismos en vivo** (USGS, últimas 24 h).
- 💱 **Mercados y divisas** con sparklines: índices (S&P 500/Nasdaq/Dow vía Yahoo) +
  divisas (BCE/Frankfurter) + cripto (CoinGecko) + spot regional USD/COP.
- 📊 **Indicadores** de inflación y crecimiento (Banco Mundial).
- 📈 **Tendencias en el tiempo** — volumen de noticias por sección (se acumula cada hora).
- 🖥️ **Modo enfoque**: clic en una sección la abre a pantalla completa.
- ⏱️ **Ticker** en vivo y reloj UTC / Panamá.

Todo es **estático + gratis**: un robot de GitHub Actions baja los datos cada hora,
los guarda como JSON y GitHub Pages sirve el sitio. **Sin servidor y sin claves de API.**

---

## Estructura

```
index.html                 # la página
assets/css/styles.css       # tema oscuro terminal
assets/js/                  # app.js · render.js · charts.js (vanilla, sin frameworks)
scripts/sources.json        # << EDITA AQUÍ tus fuentes RSS por sección
scripts/fetch_news.py       # baja titulares RSS  -> data/news.json + meta.json
scripts/fetch_data.py       # sismos/clima/mercados/indicadores -> data/*.json
data/*.json                 # datos generados (los actualiza el robot, no editar a mano)
.github/workflows/update.yml# robot horario
```

## Correr en local

Requiere solo **Python 3** (no necesita Node ni instalar nada):

```bash
# 1) genera los datos
python3 scripts/fetch_news.py
python3 scripts/fetch_data.py

# 2) sirve el sitio (abrir http://localhost:8000)
python3 -m http.server 8000
```

> Ábrelo con un servidor local, no con doble clic: el navegador bloquea `fetch`
> de archivos locales con `file://`.

## Añadir o quitar fuentes

Edita `scripts/sources.json`. Cada *beat* tiene una lista de URLs de feeds RSS/Atom:

```json
{ "id": "musica", "name": "Música & Industria",
  "feeds": ["https://pitchfork.com/rss/news/", "..."] }
```

Si una fuente falla (404, sin XML, etc.) simplemente se omite; nunca rompe la corrida.
Para una sección nueva, agrega otro objeto con su `id`, `name` y `feeds`.

## Publicar en GitHub Pages

1. Sube el repo a GitHub.
2. **Settings → Pages → Build and deployment → Source: _Deploy from a branch_**,
   rama `main`, carpeta `/ (root)`.
3. **Settings → Actions → General → Workflow permissions → _Read and write_** (para que
   el robot pueda commitear los datos).
4. Pestaña **Actions → "Actualizar datos" → Run workflow** para la primera corrida manual.
   Después corre solo cada hora.

## Fase 2 (futuro): análisis con IA

Añadir un paso en el workflow que llame a la **API de Claude** (modelo Haiku por costo)
con la clave guardada en **GitHub → Settings → Secrets**. Enriquecería `news.json` con:
resumen en español, sentimiento, agrupación por tema y un bloque "lo más importante hoy".
La clave vive solo en el servidor del robot, nunca en el navegador.

---

Fuentes de datos: RSS de cada medio · [USGS](https://earthquake.usgs.gov) ·
[Open-Meteo](https://open-meteo.com) · [Yahoo Finance](https://finance.yahoo.com) ·
[Frankfurter/BCE](https://frankfurter.app) · [CoinGecko](https://coingecko.com) ·
[Banco Mundial](https://data.worldbank.org). Gráficas con [Apache ECharts](https://echarts.apache.org).
