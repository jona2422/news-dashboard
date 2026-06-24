/* charts.js — mapa de sismos e indicadores (Apache ECharts) */
window.Charts = (function () {
  "use strict";

  var WORLD_URL = "https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json";
  var COLORS = ["#3aa0ff", "#2bd4a8", "#ffb000", "#ff7a45", "#ff4d5e", "#a468ff"];
  var instances = {};          // elId -> instancia echarts
  var mapRegistered = false;
  var lastQuakes = null, lastIndicators = null, lastHistory = null;

  function ready() { return typeof window.echarts !== "undefined"; }

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

  function magColor(m) {
    if (m >= 6) return "#ff4d5e";
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

  /* Dibuja el mapa de sismos en el elemento indicado (por defecto el del dashboard) */
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
      tooltip: {
        trigger: "item", backgroundColor: "#0b101a", borderColor: "#28384f",
        textStyle: { color: "#d6e0ee", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
        formatter: function (p) { return p.value ? "M" + p.value[2] + " · " + (p.name || "—") : p.name; }
      },
      geo: {
        map: "world", roam: true, silent: true,
        itemStyle: { areaColor: "#0e1521", borderColor: "#243248", borderWidth: 0.5 },
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

  /* Dibuja las líneas de indicadores. withSelect llena el <select> del dashboard. */
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
      tooltip: {
        trigger: "axis", backgroundColor: "#0b101a", borderColor: "#28384f",
        textStyle: { color: "#d6e0ee", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }
      },
      legend: {
        top: 0, textStyle: { color: "#8aa0bd", fontSize: 11, fontFamily: "JetBrains Mono, monospace" },
        itemWidth: 10, itemHeight: 10, icon: "roundRect"
      },
      xAxis: {
        type: "category", data: years, boundaryGap: false,
        axisLine: { lineStyle: { color: "#28384f" } },
        axisLabel: { color: "#6b7c93", fontFamily: "JetBrains Mono, monospace", fontSize: 10 }
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#6b7c93", fontFamily: "JetBrains Mono, monospace", fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { color: "#15202f" } }
      },
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

  /* Volumen de noticias por sección a lo largo del tiempo (área apilada) */
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
      tooltip: {
        trigger: "axis", backgroundColor: "#0b101a", borderColor: "#28384f",
        textStyle: { color: "#d6e0ee", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }
      },
      legend: {
        type: "scroll", top: 0,
        textStyle: { color: "#8aa0bd", fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
        itemWidth: 9, itemHeight: 9, icon: "roundRect"
      },
      xAxis: {
        type: "category", data: x, boundaryGap: false,
        axisLine: { lineStyle: { color: "#28384f" } },
        axisLabel: { color: "#6b7c93", fontFamily: "JetBrains Mono, monospace", fontSize: 9 }
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#6b7c93", fontFamily: "JetBrains Mono, monospace", fontSize: 10 },
        splitLine: { lineStyle: { color: "#15202f" } }
      },
      series: ids.map(function (id, i) {
        return {
          name: names[id] || id, type: "line", stack: "vol", smooth: true,
          showSymbol: showSym, symbolSize: 5, areaStyle: { opacity: 0.16 },
          emphasis: { focus: "series" },
          lineStyle: { width: 1.4, color: COLORS[i % COLORS.length] },
          itemStyle: { color: COLORS[i % COLORS.length] },
          data: recs.map(function (r) { return (r.beats || {})[id] || 0; })
        };
      })
    });
    chart.resize();
  }

  /* Wrappers para los paneles del dashboard */
  function initMap(quakes) { return mountMap("map", quakes); }
  function initIndicators(indicators) { return mountIndicators("indicators", indicators, null, true); }

  function resize() {
    Object.keys(instances).forEach(function (k) {
      if (instances[k] && !instances[k].isDisposed()) instances[k].resize();
    });
  }

  return {
    initMap: initMap, initIndicators: initIndicators, mountTrends: mountTrends,
    mountMap: mountMap, mountIndicators: mountIndicators,
    dispose: dispose, resize: resize
  };
})();
