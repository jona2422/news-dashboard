/* charts.js — todos los gráficos (Apache ECharts): mapas, mercados, clima y analítica */
window.Charts = (function () {
  "use strict";

  var WORLD_URL = "assets/geo/world.json";   // servido desde el propio repo
  var COLORS = ["#3aa0ff", "#2bd4a8", "#ffb000", "#ff7a45", "#ff4d5e", "#a468ff", "#22d3ee", "#ff5ea8"];
  var MONO = "JetBrains Mono, monospace";
  var instances = {};
  var mapRegistered = false;
  var lastQuakes = null, lastIndicators = null, lastHistory = null;

  function ready() { return typeof window.echarts !== "undefined"; }

  function beatColor(id, i) {
    var t = window.BeatTheme;
    if (t && t[id]) return t[id];
    return COLORS[(i || 0) % COLORS.length];
  }

  function inst(elId) {
    var el = document.getElementById(elId);
    if (!el || !ready()) return null;
    if (!instances[elId] || instances[elId].isDisposed()) {
      instances[elId] = echarts.init(el, null, { renderer: "canvas" });
    }
    return instances[elId];
  }

  function dispose(elId) {
    if (instances[elId]) { instances[elId].dispose(); delete instances[elId]; }
  }

  function tip(extra) {
    var base = {
      backgroundColor: "#0a111f", borderColor: "#263551",
      textStyle: { color: "#dbe5f3", fontFamily: MONO, fontSize: 11 }
    };
    for (var k in (extra || {})) base[k] = extra[k];
    return base;
  }

  function axis(color) {
    return {
      axisLine: { lineStyle: { color: "#263551" } },
      axisLabel: { color: color || "#6f819c", fontFamily: MONO, fontSize: 10 },
      splitLine: { lineStyle: { color: "#111b2e" } }
    };
  }

  function magColor(m) {
    if (m >= 6) return "#ff5c6e";
    if (m >= 5) return "#ff7a45";
    if (m >= 4) return "#ffb000";
    if (m >= 3) return "#2bd4a8";
    return "#3aa0ff";
  }

  async function ensureWorld() {
    if (mapRegistered) return true;
    try {
      var world = await fetch(WORLD_URL).then(function (r) { return r.json(); });
      echarts.registerMap("world", world);
      mapRegistered = true;
      return true;
    } catch (e) { console.warn("No se pudo cargar el mapa mundial:", e); return false; }
  }

  /* ============ Mapa mundial de noticias (coropletas + puntos) ============ */
  async function mountWorldNews(elId, geo, onCountry) {
    if (!ready() || !geo || !(await ensureWorld())) return;
    var chart = inst(elId || "worldmap");
    if (!chart) return;

    var countries = geo.countries || [];
    var max = Math.max.apply(null, countries.map(function (c) { return c.count; }).concat([1]));
    var byName = {};
    countries.forEach(function (c) { byName[c.name] = c; });

    // escala sqrt: sin ella, el país líder apaga a los de 1-3 menciones
    var mapData = countries.map(function (c) { return { name: c.name, value: Math.sqrt(c.count) }; });
    var dots = countries.map(function (c) {
      return { name: c.name, value: [c.lon, c.lat, c.count] };
    });

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: tip({
        trigger: "item",
        formatter: function (p) {
          var c = byName[p.name];
          if (!c) return p.name;
          var head = c.es + " · " + c.count + (c.count === 1 ? " mención" : " menciones");
          var lines = (c.items || []).slice(0, 3).map(function (it) {
            var t = it.title.length > 64 ? it.title.slice(0, 64) + "…" : it.title;
            return '<span style="color:#6f819c">›</span> ' + t;
          });
          return "<b>" + head + "</b>" + (lines.length ? "<br>" + lines.join("<br>") : "") +
            '<br><span style="color:#2bd4a8">clic para ver todo</span>';
        }
      }),
      visualMap: {
        min: 0, max: Math.sqrt(max), show: false, seriesIndex: 0,
        inRange: { color: ["#11243c", "#155066", "#1b8a71", "#2bd4a8"] }
      },
      // un solo geo: la serie map se liga con geoIndex y todo panea junto
      geo: {
        map: "world", roam: true, zoom: 1.18, scaleLimit: { min: 1, max: 9 },
        itemStyle: { areaColor: "#0a1322", borderColor: "#1c2b47", borderWidth: 0.5 },
        emphasis: {
          label: { show: true, color: "#ffffff", fontFamily: MONO, fontSize: 10 },
          itemStyle: { areaColor: "#1d4f43", shadowBlur: 12, shadowColor: "rgba(43,212,168,.35)" }
        },
        select: { disabled: true }
      },
      series: [
        {
          name: "menciones", type: "map", map: "world", geoIndex: 0,
          data: mapData
        },
        {
          name: "focos", type: "effectScatter", coordinateSystem: "geo", zlevel: 2,
          silent: true,
          symbolSize: function (v) { return Math.min(4 + v[2] * 1.1, 16); },
          rippleEffect: { brushType: "stroke", scale: 2.4 },
          itemStyle: { color: "#2bd4a8", shadowBlur: 8, shadowColor: "rgba(43,212,168,.6)", opacity: .85 },
          data: dots
        }
      ]
    });

    chart.off("click");
    if (onCountry) {
      chart.on("click", function (p) {
        var c = byName[p.name];
        if (c) onCountry(c);
      });
    }
    chart.resize();
  }

  /* ============ Radar sísmico global (USGS 24h, todo el mundo) ============ */
  async function mountLatam(elId, quakes, geo) {
    if (!ready() || !(await ensureWorld())) return;
    var chart = inst(elId || "latammap");
    if (!chart) return;

    // Todos los sismos del mundo. Los fuertes (M≥4.5) pulsan; el resto son puntos.
    var big = [], small = [];
    ((quakes && quakes.items) || []).forEach(function (q) {
      var pt = { name: q.place, value: [q.lon, q.lat, q.mag] };
      (q.mag >= 4.5 ? big : small).push(pt);
    });

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: tip({
        trigger: "item",
        formatter: function (p) {
          if (p.seriesName === "PTY") return "Ciudad de Panamá";
          return "<b>M" + p.value[2] + "</b> · " + (p.name || "—");
        }
      }),
      visualMap: {
        type: "piecewise", dimension: 2, seriesIndex: [0, 1],
        pieces: [
          { min: 6, label: "M6+", color: "#ff5c6e" },
          { min: 5, max: 6, label: "M5–6", color: "#ff7a45" },
          { min: 4, max: 5, label: "M4–5", color: "#ffb000" },
          { min: 3, max: 4, label: "M3–4", color: "#2bd4a8" },
          { max: 3, label: "<M3", color: "#3aa0ff" }
        ],
        right: 8, bottom: 8, itemWidth: 9, itemHeight: 9, itemGap: 3,
        textStyle: { color: "#8aa0bd", fontFamily: MONO, fontSize: 9 }
      },
      geo: {
        map: "world", roam: true, zoom: 1.15, scaleLimit: { min: 1, max: 10 },
        itemStyle: { areaColor: "#0a1626", borderColor: "#1c3350", borderWidth: 0.6 },
        emphasis: { label: { show: false }, itemStyle: { areaColor: "#12233c" } },
        regions: [{ name: "Panama", itemStyle: { areaColor: "#144a3c", borderColor: "#2bd4a8", borderWidth: 1.1 } }]
      },
      series: [
        {
          name: "Sismos", type: "effectScatter", coordinateSystem: "geo", zlevel: 3,
          symbolSize: function (v) { return Math.max(6, (v[2] - 1) * 3.4); },
          rippleEffect: { brushType: "stroke", scale: 3 }, showEffectOn: "render",
          itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,.45)" },
          data: big
        },
        {
          name: "Sismos menores", type: "scatter", coordinateSystem: "geo", zlevel: 2,
          symbolSize: function (v) { return Math.max(3, (v[2] - 1) * 2.4); },
          itemStyle: { opacity: .82 },
          data: small
        },
        {
          name: "PTY", type: "scatter", coordinateSystem: "geo", zlevel: 4,
          symbol: "pin", symbolSize: 24,
          itemStyle: { color: "#2bd4a8" },
          label: { show: true, formatter: "PTY", position: "top", color: "#2bd4a8", fontFamily: MONO, fontSize: 9, fontWeight: 700 },
          data: [{ name: "Ciudad de Panamá", value: [-79.52, 8.98, 3] }]
        }
      ]
    });
    chart.resize();
  }

  /* ============ Histórico grande de mercados ============ */
  function mountMarketBig(elId, item) {
    if (!ready() || !item || !item.hist) return;
    var chart = inst(elId || "mktbig");
    if (!chart) return;

    var v = item.hist.v, d = item.hist.d;
    var first = v[0], last = v[v.length - 1];
    var pct = first ? ((last - first) / first) * 100 : 0;
    var up = pct >= 0;
    var col = up ? "#34e3b6" : "#ff5c6e";

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 58, right: 18, top: 34, bottom: 46 },
      tooltip: tip({
        trigger: "axis",
        formatter: function (ps) {
          var p = ps[0];
          return p.axisValue + "<br><b>" + item.label + "</b> " +
            Number(p.value).toLocaleString("en-US", { maximumFractionDigits: 4 });
        }
      }),
      xAxis: Object.assign(axis(), {
        type: "category", data: d, boundaryGap: false,
        axisLabel: {
          color: "#6f819c", fontFamily: MONO, fontSize: 9,
          formatter: function (val) { return val.slice(5); }   // MM-DD
        },
        splitLine: { show: false }
      }),
      yAxis: Object.assign(axis(), { type: "value", scale: true }),
      dataZoom: [
        { type: "inside" },
        {
          type: "slider", height: 16, bottom: 8,
          borderColor: "#263551", backgroundColor: "#070c15",
          fillerColor: "rgba(43,212,168,.12)",
          handleStyle: { color: "#2bd4a8" },
          textStyle: { color: "#6f819c", fontFamily: MONO, fontSize: 9 },
          dataBackground: { lineStyle: { color: "#263551" }, areaStyle: { color: "rgba(38,53,81,.3)" } }
        }
      ],
      series: [{
        name: item.label, type: "line", smooth: true, showSymbol: false,
        data: v,
        lineStyle: { width: 2, color: col },
        itemStyle: { color: col },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: up ? "rgba(52,227,182,.28)" : "rgba(255,92,110,.28)" },
            { offset: 1, color: "rgba(0,0,0,0)" }
          ])
        },
        markPoint: {
          symbol: "circle", symbolSize: 5,
          label: { color: "#dbe5f3", fontFamily: MONO, fontSize: 9, offset: [0, -8] },
          data: [
            { type: "max", name: "máx" },
            { type: "min", name: "mín", label: { offset: [0, 10] } }
          ],
          itemStyle: { color: "#ffb000" }
        }
      }]
    });

    var meta = document.getElementById("mkt-meta");
    if (meta) {
      meta.textContent = (up ? "▲ +" : "▼ ") + pct.toFixed(1) + "% en 6 meses";
      meta.style.color = col;
    }
    chart.resize();
  }

  /* ============ Clima por horas (línea temp + barras lluvia) ============ */
  function mountWxHours(elId, weather) {
    if (!ready() || !weather || !weather.hourly || !weather.hourly.length) return;
    var chart = inst(elId || "wxhours");
    if (!chart) return;
    var hs = weather.hourly;

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 34, right: 34, top: 18, bottom: 20 },
      tooltip: tip({
        trigger: "axis",
        formatter: function (ps) {
          var out = ps[0].axisValue;
          ps.forEach(function (p) {
            out += "<br>" + p.marker + p.seriesName + ": <b>" + p.value +
              (p.seriesName === "Temp" ? "°" : "%") + "</b>";
          });
          return out;
        }
      }),
      xAxis: Object.assign(axis(), {
        type: "category", data: hs.map(function (h) { return h.t; }),
        boundaryGap: false, splitLine: { show: false },
        axisLabel: { color: "#6f819c", fontFamily: MONO, fontSize: 9, interval: 3 }
      }),
      yAxis: [
        Object.assign(axis(), { type: "value", scale: true, axisLabel: { color: "#6f819c", fontFamily: MONO, fontSize: 9, formatter: "{value}°" } }),
        { type: "value", min: 0, max: 100, show: false }
      ],
      series: [
        {
          name: "Lluvia", type: "bar", yAxisIndex: 1, silent: true,
          itemStyle: { color: "rgba(58,160,255,.32)", borderRadius: [2, 2, 0, 0] },
          barWidth: "55%",
          data: hs.map(function (h) { return h.pop == null ? 0 : h.pop; })
        },
        {
          name: "Temp", type: "line", smooth: true, showSymbol: false, zlevel: 2,
          lineStyle: { width: 2, color: "#ffb000" },
          itemStyle: { color: "#ffb000" },
          data: hs.map(function (h) { return h.temp; })
        }
      ]
    });
    chart.resize();
  }

  /* ============ Donut: tu lectura por sección ============ */
  function mountReadDonut(elId, rows) {
    if (!ready() || !rows) return;
    var chart = inst(elId || "readdonut");
    if (!chart) return;
    var total = rows.reduce(function (a, r) { return a + r.value; }, 0);

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: tip({ trigger: "item", formatter: "{b}: <b>{c}</b> ({d}%)" }),
      legend: {
        orient: "vertical", right: 6, top: "middle",
        textStyle: { color: "#8aa0bd", fontSize: 10, fontFamily: MONO },
        itemWidth: 9, itemHeight: 9, icon: "roundRect"
      },
      series: [{
        type: "pie", radius: ["52%", "76%"], center: ["36%", "50%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#0a111f", borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: false }, scaleSize: 4 },
        data: rows.map(function (r) {
          return { name: r.name, value: r.value, itemStyle: { color: r.color } };
        })
      }],
      title: {
        text: String(total), subtext: rows._label || "leídas",
        left: "35%", top: "42%", textAlign: "center",
        textStyle: { color: "#ffffff", fontFamily: MONO, fontSize: 22, fontWeight: 700 },
        subtextStyle: { color: "#6f819c", fontFamily: MONO, fontSize: 10 }
      }
    });
    chart.resize();
  }

  /* ============ Barras horizontales: protagonistas ============ */
  function mountEntities(elId, entities, onClick) {
    if (!ready() || !entities || !entities.length) return;
    var chart = inst(elId || "entbar");
    if (!chart) return;
    var rows = entities.slice(0, 10).reverse();

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: tip({ trigger: "item", formatter: "{b}: <b>{c}</b> menciones · clic para buscar" }),
      xAxis: Object.assign(axis(), { type: "value", splitLine: { show: false }, axisLabel: { show: false }, axisLine: { show: false } }),
      yAxis: Object.assign(axis(), {
        type: "category",
        data: rows.map(function (e) { return e.name; }),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: "#dbe5f3", fontFamily: MONO, fontSize: 11 }
      }),
      series: [{
        type: "bar", barWidth: 12,
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#177a63" }, { offset: 1, color: "#2bd4a8" }
          ])
        },
        label: { show: true, position: "right", color: "#2bd4a8", fontFamily: MONO, fontSize: 10 },
        data: rows.map(function (e) { return e.count; })
      }]
    });
    chart.off("click");
    if (onClick) chart.on("click", function (p) { onClick(p.name); });
    chart.resize();
  }

  /* ============ Mapa de sismos global (modo enfoque) ============ */
  async function mountMap(elId, quakes) {
    elId = elId || "map";
    if (quakes) lastQuakes = quakes;
    if (!ready() || !lastQuakes) return;
    if (!(await ensureWorld())) return;
    var chart = inst(elId);
    if (!chart) return;

    var data = (lastQuakes.items || []).map(function (q) {
      return { name: q.place, value: [q.lon, q.lat, q.mag], itemStyle: { color: magColor(q.mag) } };
    });

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: tip({
        trigger: "item",
        formatter: function (p) { return p.value ? "M" + p.value[2] + " · " + (p.name || "—") : p.name; }
      }),
      geo: {
        map: "world", roam: true, silent: true,
        itemStyle: { areaColor: "#0c1524", borderColor: "#22314f", borderWidth: 0.5 },
        scaleLimit: { min: 1, max: 8 }
      },
      series: [{
        name: "Sismos", type: "effectScatter", coordinateSystem: "geo", data: data, zlevel: 2,
        symbolSize: function (v) { return Math.max(4, (v[2] - 1) * 3.2); },
        showEffectOn: "render", rippleEffect: { brushType: "stroke", scale: 2.6 },
        itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,.4)" }
      }]
    });
    chart.resize();
  }

  /* ============ Indicadores (Banco Mundial) ============ */
  function mountIndicators(elId, indicators, selectedIdx, withSelect) {
    elId = elId || "indicators";
    if (indicators) lastIndicators = indicators;
    if (!ready() || !lastIndicators) return;
    var series = lastIndicators.series || [];
    if (!series.length) return;

    var idx = (typeof selectedIdx === "number") ? selectedIdx : 0;

    if (withSelect) {
      var sel = document.getElementById("ind-select");
      if (sel && !sel.dataset.ready) {
        sel.innerHTML = "";
        series.forEach(function (s, i) {
          var o = document.createElement("option");
          o.value = i; o.textContent = s.label; sel.appendChild(o);
        });
        sel.dataset.ready = "1";
        sel.addEventListener("change", function () {
          mountIndicators("indicators", null, parseInt(sel.value, 10), false);
        });
      }
      if (sel) idx = parseInt(sel.value, 10) || 0;
    }

    var s = series[idx] || series[0];
    var years = (s.countries[0].points || []).map(function (p) { return p.year; });
    var chart = inst(elId);
    if (!chart) return;

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 42, right: 14, top: 30, bottom: 24 },
      tooltip: tip({ trigger: "axis" }),
      legend: {
        top: 0, textStyle: { color: "#8aa0bd", fontSize: 11, fontFamily: MONO },
        itemWidth: 10, itemHeight: 10, icon: "roundRect"
      },
      xAxis: Object.assign(axis(), { type: "category", data: years, boundaryGap: false, splitLine: { show: false } }),
      yAxis: Object.assign(axis(), { type: "value", axisLabel: { color: "#6f819c", fontFamily: MONO, fontSize: 10, formatter: "{value}%" } }),
      series: s.countries.map(function (c, i) {
        var map = {};
        c.points.forEach(function (p) { map[p.year] = p.value; });
        return {
          name: c.name, type: "line", smooth: true, showSymbol: false, connectNulls: true,
          data: years.map(function (y) { return map[y] != null ? map[y] : null; }),
          lineStyle: { width: 2, color: COLORS[i % COLORS.length] },
          itemStyle: { color: COLORS[i % COLORS.length] }
        };
      })
    });
    chart.resize();
  }

  /* ============ Tendencias: volumen por sección ============ */
  function mountTrends(elId, history) {
    elId = elId || "trends";
    if (history) lastHistory = history;
    if (!ready() || !lastHistory) return;
    var recs = lastHistory.records || [];
    var chart = inst(elId);
    if (!chart) return;

    var names = {};
    var store = window.Store || {};
    ((store.news && store.news.beats) || []).forEach(function (b) { names[b.id] = b.name; });
    var ids = recs.length ? Object.keys(recs[recs.length - 1].beats || {}) : Object.keys(names);

    var x = recs.map(function (r) {
      var d = new Date(r.t);
      return (d.getMonth() + 1) + "/" + d.getDate() + " " +
        ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    });
    var showSym = recs.length < 3;

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 36, right: 14, top: 30, bottom: 24 },
      tooltip: tip({ trigger: "axis" }),
      legend: {
        type: "scroll", top: 0,
        textStyle: { color: "#8aa0bd", fontSize: 10, fontFamily: MONO },
        itemWidth: 9, itemHeight: 9, icon: "roundRect"
      },
      xAxis: Object.assign(axis(), { type: "category", data: x, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: "#6f819c", fontFamily: MONO, fontSize: 9 } }),
      yAxis: Object.assign(axis(), { type: "value" }),
      series: ids.map(function (id, i) {
        var col = beatColor(id, i);
        return {
          name: names[id] || id, type: "line", stack: "vol", smooth: true,
          showSymbol: showSym, symbolSize: 5, areaStyle: { opacity: 0.16 },
          emphasis: { focus: "series" },
          lineStyle: { width: 1.4, color: col },
          itemStyle: { color: col },
          data: recs.map(function (r) { return (r.beats || {})[id] || 0; })
        };
      })
    });
    chart.resize();
  }

  function resize() {
    Object.keys(instances).forEach(function (k) {
      if (instances[k] && !instances[k].isDisposed()) instances[k].resize();
    });
  }

  return {
    mountWorldNews: mountWorldNews, mountLatam: mountLatam,
    mountMarketBig: mountMarketBig, mountWxHours: mountWxHours,
    mountReadDonut: mountReadDonut, mountEntities: mountEntities,
    mountMap: mountMap, mountIndicators: mountIndicators, mountTrends: mountTrends,
    dispose: dispose, resize: resize
  };
})();
