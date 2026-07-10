# NEWSDESK 2.0 — La redacción de Jonathan

Dashboard personal tipo *terminal* (Bloomberg-style) que reúne, en un solo lugar,
los temas que me interesan, con mapas interactivos, datos en tiempo real y gráficas.

**Funciona como una pequeña redacción** con secciones (beats), cada una con su color:
Música & Industria · Arte/Cultura/Educación · Tecnología & IA · Actualidad Global ·
Panamá/LatAm · Desastres Naturales · Medio Oriente · China.

Incluye:
- 🌍 **El mundo en titulares** — mapa mundial de calor: qué países aparecen más en los
  titulares de hoy (detección sin IA, por nombres/capitales en ES+EN). Clic en un país
  o en el ranking lateral abre sus noticias a pantalla completa.
- 📡 **Radar Panamá/LatAm** — mapa regional con sismos USGS (24 h), menciones de
  noticias por país y pin de Ciudad de Panamá.
- 📰 **Portada "Lo más importante"** — titulares con mayor cobertura + recencia,
  de todas las secciones; filtra alertas automáticas (sismos/GDACS).
- 📟 **Franja de KPIs** — clima, titulares, países, sismos, S&P, BTC, EUR/USD y
  salud de fuentes de un vistazo, con sparklines.
- 🌦️ **Clima de Panamá** — actual + próximas 24 h (gráfica temp/lluvia) + 7 días,
  con UV y salida/puesta de sol (Open-Meteo, sin API key).
- 📈 **Histórico de mercados** — 6 meses por instrumento (índices, divisas, cripto)
  con zoom, máximos/mínimos y pestañas; ademas **heatmap de rendimiento** del día.
- 🧠 **Analítica** — dona de *tu lectura por sección* (local, privada), barras de
  protagonistas del día (clic = buscar) y tendencias de volumen por sección.
- 🩺 **Salud de fuentes** — cuántos feeds responden y cuáles fallan.
- 🔎 **Buscador y filtros** en vivo (texto, fuente, últimas 24 h / 7 días).
- 🔥 **Temas calientes** — términos y entidades más mencionados (sin IA); además
  **deduplica** la misma noticia repetida entre fuentes (badge ▣ N).
- ⭐ **Personal y persistente** (localStorage): marca leídos, **guarda** favoritos,
  badge de **"nuevas desde tu última visita"** y oculta secciones; saludo por hora
  del día en Panamá.
- 🖥️ **Modo enfoque**: clic en una sección (o país) la abre a pantalla completa.
- ⏱️ **Ticker** en vivo, reloj UTC/Panamá e Indicadores del Banco Mundial.

Todo es **estático + gratis**: un robot de GitHub Actions baja los datos cada hora,
los guarda como JSON y GitHub Pages sirve el sitio. **Sin servidor y sin claves de API.**

---

## Estructura

```
index.html                 # la página
assets/css/styles.css       # tema oscuro terminal 2.0 (tokens + acentos por sección)
assets/js/                  # app.js · render.js · charts.js (vanilla, sin frameworks)
assets/geo/world.json       # geometría del mapa mundial (servida desde el repo)
scripts/sources.json        # << EDITA AQUÍ tus fuentes RSS por sección
scripts/fetch_news.py       # titulares RSS + países -> data/news.json, geo.json, meta.json
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
