/* app.js — orquesta carga de datos, reloj y refresco automático */
(function () {
  "use strict";

  var FILES = {
    news: "data/news.json",
    quakes: "data/quakes.json",
    weather: "data/weather.json",
    markets: "data/markets.json",
    indicators: "data/indicators.json",
    trends: "data/trends.json",
    history: "data/history.json",
    meta: "data/meta.json"
  };
  var REFRESH_MS = 10 * 60 * 1000; // re-lee los JSON cada 10 min
  var state = {};
  window.Store = state;            // compartido con el modo enfoque (render.js)

  function clock() {
    var el = document.getElementById("clock");
    if (!el) return;
    var now = new Date();
    var utc = now.toISOString().slice(11, 19);
    var pa = now.toLocaleTimeString("es-PA", { hour12: false, timeZone: "America/Panama" });
    el.textContent = "PA " + pa + " · UTC " + utc;
  }

  function load(key) {
    return fetch(FILES[key] + "?t=" + Date.now()).then(function (r) {
      if (!r.ok) throw new Error(key + " " + r.status);
      return r.json();
    });
  }

  function setUpdated(iso) {
    var el = document.getElementById("updated");
    if (el && iso) el.textContent = "actualizado " + Render.timeAgo(new Date(iso).getTime());
  }

  function refresh() {
    Promise.allSettled([
      load("news"), load("quakes"), load("weather"), load("markets"),
      load("indicators"), load("trends"), load("history"), load("meta")
    ]).then(function (res) {
      var news = res[0], quakes = res[1], weather = res[2], markets = res[3],
        indicators = res[4], trends = res[5], history = res[6], meta = res[7];

      if (news.status === "fulfilled") {
        state.news = news.value;
        Render.renderBeats(state.news);
        Render.renderPortada(state.news);
      }
      if (weather.status === "fulfilled") { state.weather = weather.value; Render.renderWeather(state.weather); }
      if (markets.status === "fulfilled") { state.markets = markets.value; Render.renderMarkets(state.markets); }
      if (quakes.status === "fulfilled") {
        state.quakes = quakes.value;
        Charts.initMap(state.quakes);
        var qm = document.getElementById("quake-meta");
        if (qm) qm.textContent = state.quakes.count + " eventos · máx M" + state.quakes.max;
      }
      if (indicators.status === "fulfilled") { state.indicators = indicators.value; Charts.initIndicators(state.indicators); }
      if (trends.status === "fulfilled") { state.trends = trends.value; Render.renderHot(state.trends); }
      if (history.status === "fulfilled") { state.history = history.value; Charts.mountTrends("trends", state.history); }
      if (meta.status === "fulfilled") { state.meta = meta.value; Render.renderHealth(state.meta); }
      Render.buildTicker(state.markets, state.quakes);
      Render.renderSettings();
      Render.updateSavedCount();

      var iso = (meta.status === "fulfilled" && meta.value.updated) ||
        (state.news && state.news.updated);
      setUpdated(iso);
    });
  }

  function wireControls() {
    var q = document.getElementById("q");
    var clr = document.getElementById("q-clear");
    if (q) q.addEventListener("input", function () {
      if (clr) clr.hidden = !q.value;
      Render.setFilter({ q: q.value.trim() });
    });
    if (clr) clr.addEventListener("click", function () {
      q.value = ""; clr.hidden = true; Render.setFilter({ q: "" });
    });

    var seg = document.getElementById("timefilter");
    if (seg) seg.addEventListener("click", function (e) {
      var btn = e.target.closest("button"); if (!btn) return;
      seg.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      Render.setFilter({ time: parseInt(btn.dataset.t, 10) || 0 });
    });

    var src = document.getElementById("source");
    if (src) src.addEventListener("change", function () { Render.setFilter({ source: src.value }); });

    var savedBtn = document.getElementById("saved-btn");
    if (savedBtn) savedBtn.addEventListener("click", Render.openSaved);

    var setBtn = document.getElementById("settings-btn");
    var pop = document.getElementById("settings-pop");
    if (setBtn && pop) {
      setBtn.addEventListener("click", function (e) {
        e.stopPropagation(); pop.hidden = !pop.hidden;
      });
      document.addEventListener("click", function (e) {
        if (!pop.hidden && !pop.contains(e.target) && e.target !== setBtn) pop.hidden = true;
      });
    }
  }

  function start() {
    clock();
    setInterval(clock, 1000);
    wireControls();
    refresh();
    setInterval(refresh, REFRESH_MS);
    window.addEventListener("resize", function () { Charts.resize(); });

    var back = document.getElementById("focus-back");
    if (back) back.addEventListener("click", Render.closeFocus);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") Render.closeFocus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
