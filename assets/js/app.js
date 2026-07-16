/* app.js — orquesta carga de datos, reloj y refresco automático */
(function () {
  "use strict";

  var FILES = {
    news: "data/news.json",
    geo: "data/geo.json",
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
    var keys = ["news", "geo", "quakes", "weather", "markets",
                "indicators", "trends", "history", "meta"];
    Promise.allSettled(keys.map(load)).then(function (res) {
      keys.forEach(function (k, i) {
        if (res[i].status === "fulfilled") state[k] = res[i].value;
      });

      if (state.news) {
        Render.renderBeats(state.news);
        Render.renderPortada(state.news);
      }
      if (state.weather) Render.renderWeather(state.weather);
      if (state.markets) {
        Render.renderMarkets(state.markets);
        Render.renderSideMarkets();
        Render.renderMarketTabs();
      }
      if (state.geo) {
        Render.renderGeoRank(state.geo);
        if (window.Charts) Charts.mountWorldNews("worldmap", state.geo, Render.openCountry);
      }
      if (state.quakes || state.geo) {
        if (window.Charts) Charts.mountLatam("latammap", state.quakes, state.geo);
        var lm = document.getElementById("latam-meta");
        if (lm && state.quakes) lm.textContent = state.quakes.count + " sismos · máx M" + state.quakes.max;
      }
      if (state.indicators && window.Charts) Charts.mountIndicators("indicators", state.indicators, null, true);
      if (state.trends) Render.renderHot(state.trends);
      if (state.meta) Render.renderHealth(state.meta);

      Render.renderKpis(state);
      Render.renderAnalytics(state.trends);
      Render.buildTicker(state.markets, state.quakes, state.geo);
      Render.renderSettings();
      Render.updateSavedCount();

      var iso = (state.meta && state.meta.updated) || (state.news && state.news.updated);
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
    Render.renderGreet();
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
