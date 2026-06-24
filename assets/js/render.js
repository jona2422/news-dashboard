/* render.js — noticias, mercados, ticker, filtros, temas calientes y modo enfoque */
window.Render = (function () {
  "use strict";

  var _news = null;
  var filter = { q: "", time: 0, source: "" };

  var FOCUS_CHART = {
    desastres:  { type: "map", title: "Sismos en vivo · USGS (24h)" },
    actualidad: { type: "ind", idx: 1, title: "Crecimiento del PIB (%) · Banco Mundial" },
    china:      { type: "ind", idx: 1, title: "Crecimiento del PIB (%) · Banco Mundial" }
  };

  /* ---------- helpers ---------- */
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function timeAgo(ts) {
    if (!ts) return "";
    var s = (Date.now() - ts) / 1000;
    if (s < 60) return "ahora";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }
  function fmtPrice(n) {
    if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (n >= 100) return n.toFixed(2);
    return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  function sparkline(vals, color) {
    if (!vals || vals.length < 2) return "";
    var w = 64, h = 26, min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var pts = vals.map(function (v, i) {
      return ((i / (vals.length - 1)) * w).toFixed(1) + "," +
        (h - ((v - min) / span) * (h - 2) - 1).toFixed(1);
    }).join(" ");
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" ' +
      'stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  /* ---------- una noticia (tarjeta) reutilizable ---------- */
  function headlineLi(it) {
    var US = window.UserStore;
    var li = document.createElement("li");
    li.className = "hl";
    if (US && US.isRead(it.link)) li.classList.add("read");
    if (US && US.isNew(it.ts)) li.classList.add("fresh");

    var a = document.createElement("a");
    a.className = "hl-link"; a.href = it.link; a.target = "_blank"; a.rel = "noopener";

    if (it.image) {
      var th = document.createElement("div");
      th.className = "hl-thumb";
      th.style.backgroundImage = "url('" + String(it.image).replace(/'/g, "%27") + "')";
      a.appendChild(th);
    }

    var dup = (it.count && it.count > 1)
      ? '<span class="hl-dup" title="' + it.count + ' fuentes cubren esto">▣ ' + it.count + "</span>" : "";
    var dot = (US && US.isNew(it.ts)) ? '<span class="fresh-dot" title="nueva"></span>' : "";
    var txt = document.createElement("div");
    txt.className = "hl-text";
    txt.innerHTML =
      '<span class="hl-title">' + dot + escapeHtml(it.title) + "</span>" +
      '<span class="hl-meta"><span class="src">' + escapeHtml(it.source || host(it.link)) + "</span>" +
      '<span class="ago">' + timeAgo(it.ts) + "</span>" + dup + "</span>";
    a.appendChild(txt);
    a.addEventListener("click", function () { if (US) US.markRead(it.link); li.classList.add("read"); });
    li.appendChild(a);

    var save = document.createElement("button");
    save.type = "button"; save.className = "hl-save"; save.title = "Guardar";
    var on = US && US.isSaved(it.link);
    save.classList.toggle("on", !!on); save.textContent = on ? "★" : "☆";
    save.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var nowSaved = US.toggleSave({ link: it.link, title: it.title, source: it.source, image: it.image, ts: it.ts });
      save.classList.toggle("on", nowSaved); save.textContent = nowSaved ? "★" : "☆";
      updateSavedCount();
    });
    li.appendChild(save);
    return li;
  }

  /* ---------- filtros ---------- */
  function matches(it) {
    if (filter.time && (!it.ts || it.ts < Date.now() - filter.time)) return false;
    if (filter.source && it.source !== filter.source) return false;
    if (filter.q) {
      var q = filter.q.toLowerCase();
      if ((it.title || "").toLowerCase().indexOf(q) < 0 &&
          (it.source || "").toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function setFilter(part) { for (var k in part) filter[k] = part[k]; renderBeats(); }
  function setSearch(q) {
    var inp = document.getElementById("q"); if (inp) inp.value = q;
    var clr = document.getElementById("q-clear"); if (clr) clr.hidden = !q;
    filter.q = q; renderBeats();
    var beats = document.querySelector(".beats");
    if (beats) window.scrollTo({ top: beats.offsetTop - 70, behavior: "smooth" });
  }

  function populateSources(news) {
    var sel = document.getElementById("source");
    if (!sel || sel.dataset.ready) return;
    var set = {};
    news.beats.forEach(function (b) { b.items.forEach(function (it) { if (it.source) set[it.source] = 1; }); });
    Object.keys(set).sort().forEach(function (s) {
      var o = document.createElement("option"); o.value = s; o.textContent = s; sel.appendChild(o);
    });
    sel.dataset.ready = "1";
  }

  /* ---------- dashboard de secciones ---------- */
  function renderBeats(news) {
    if (news) _news = news;
    if (!_news) return;
    var US = window.UserStore;
    var root = document.getElementById("beats");
    var nav = document.getElementById("beatnav");
    if (!root) return;
    root.innerHTML = "";
    if (nav) nav.innerHTML = "";
    populateSources(_news);

    _news.beats.forEach(function (b) {
      var shown = b.items.filter(matches);
      var newCount = US ? b.items.filter(function (it) { return US.isNew(it.ts); }).length : 0;

      if (nav) {
        var a = document.createElement("a");
        a.href = "#";
        a.innerHTML = escapeHtml(b.name) + '<span class="n">' + shown.length + "</span>" +
          (newCount ? '<span class="nav-new">' + newCount + "</span>" : "");
        a.addEventListener("click", function (e) { e.preventDefault(); openFocus(b.id); });
        nav.appendChild(a);
      }

      if (US && US.isHidden(b.id)) return;

      var card = document.createElement("article");
      card.className = "panel beat"; card.id = "beat-" + b.id;
      var head = document.createElement("div");
      head.className = "panel-head"; head.title = "Abrir a pantalla completa";
      head.innerHTML = "<h2>" + escapeHtml(b.name) + "</h2>" +
        (newCount ? '<span class="head-new">' + newCount + " nuevas</span>" : "") +
        '<span class="expand">⤢</span>';
      head.addEventListener("click", function () { openFocus(b.id); });
      card.appendChild(head);

      var ul = document.createElement("ul");
      ul.className = "headlines";
      if (!shown.length) {
        var e = document.createElement("li"); e.className = "empty";
        e.textContent = "Sin resultados con el filtro actual."; ul.appendChild(e);
      } else {
        shown.forEach(function (it) { ul.appendChild(headlineLi(it)); });
      }
      card.appendChild(ul);
      root.appendChild(card);
    });
  }

  /* ---------- mercados ---------- */
  function renderMarkets(markets) {
    var root = document.getElementById("markets");
    if (!root) return;
    root.innerHTML = "";
    (markets.items || []).forEach(function (m) {
      var pct = m.changePct || 0;
      var dir = pct > 0.001 ? "up" : pct < -0.001 ? "down" : "flat";
      var arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
      var color = dir === "up" ? "#2bd4a8" : dir === "down" ? "#ff4d5e" : "#6b7c93";
      var chgTxt = (m.spark && m.spark.length) ? arrow + " " + Math.abs(pct).toFixed(2) + "%" : "spot";
      var el = document.createElement("div");
      el.className = "mkt";
      el.innerHTML =
        '<span class="label">' + escapeHtml(m.label) + "</span>" +
        '<span class="price">' + fmtPrice(m.price) + "</span>" +
        '<span class="chg ' + dir + '">' + chgTxt + "</span>" + sparkline(m.spark, color);
      root.appendChild(el);
    });
  }

  function buildTicker(markets, quakes) {
    var track = document.getElementById("ticker-track");
    if (!track) return;
    var parts = [];
    ((markets && markets.items) || []).forEach(function (m) {
      var pct = m.changePct || 0;
      var cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
      var tail = (m.spark && m.spark.length)
        ? ' <span class="' + cls + '">' + (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%</span>" : "";
      parts.push('<span class="ticker-item"><b>' + m.label + "</b> " + fmtPrice(m.price) + tail + "</span>");
    });
    if (quakes && quakes.items && quakes.items.length) {
      var top = quakes.items[0];
      parts.push('<span class="ticker-item quake">⚡ SISMO M' + top.mag + " · " + escapeHtml(top.place) + "</span>");
    }
    track.innerHTML = parts.length ? parts.join("") + parts.join("") : "";
  }

  /* ---------- temas calientes ---------- */
  function renderHot(trends) {
    var root = document.getElementById("hot");
    if (!root) return;
    root.innerHTML = "";
    var items = [];
    (trends.entities || []).slice(0, 12).forEach(function (e) { items.push({ label: e.name, count: e.count, cls: "ent" }); });
    (trends.terms || []).slice(0, 12).forEach(function (t) { items.push({ label: t.term, count: t.count, cls: "term" }); });
    if (!items.length) return;
    var max = Math.max.apply(null, items.map(function (i) { return i.count; }));
    var lab = document.createElement("span"); lab.className = "hot-label"; lab.textContent = "🔥 Temas calientes";
    root.appendChild(lab);
    items.forEach(function (it) {
      var c = document.createElement("button");
      c.type = "button"; c.className = "chip " + it.cls;
      c.style.fontSize = (0.72 + (it.count / max) * 0.45).toFixed(2) + "rem";
      c.innerHTML = escapeHtml(it.label) + '<span class="chip-n">' + it.count + "</span>";
      c.addEventListener("click", function () { setSearch(it.label); });
      root.appendChild(c);
    });
  }

  /* ---------- overlay (enfoque / guardados) ---------- */
  function showOverlay() {
    var f = document.getElementById("focus");
    var body = document.querySelector(".focus-body");
    if (body) body.scrollTop = 0;
    document.body.style.overflow = "hidden";
    f.hidden = false;
    requestAnimationFrame(function () { f.classList.add("open"); });
  }

  function openFocus(beatId) {
    if (!_news) return;
    var beat = null;
    _news.beats.forEach(function (b) { if (b.id === beatId) beat = b; });
    if (!beat) return;
    document.getElementById("focus-title").textContent = beat.name;
    document.getElementById("focus-count").textContent = beat.items.length + " titulares";
    var list = document.getElementById("focus-list");
    list.innerHTML = "";
    beat.items.forEach(function (it) { list.appendChild(headlineLi(it)); });

    var wrap = document.getElementById("focus-chart-wrap");
    var cfg = FOCUS_CHART[beatId];
    if (window.Charts) Charts.dispose("focus-chart");
    wrap.hidden = !(cfg && window.Charts);
    if (!wrap.hidden) document.getElementById("focus-chart-title").textContent = cfg.title;
    showOverlay();
    if (!wrap.hidden) {
      requestAnimationFrame(function () {
        var store = window.Store || {};
        if (cfg.type === "map" && store.quakes) Charts.mountMap("focus-chart", store.quakes);
        else if (cfg.type === "ind" && store.indicators) Charts.mountIndicators("focus-chart", store.indicators, cfg.idx, false);
        else wrap.hidden = true;
      });
    }
  }

  function openSaved() {
    var US = window.UserStore;
    var saved = US ? US.savedList() : [];
    document.getElementById("focus-title").textContent = "★ Guardados";
    document.getElementById("focus-count").textContent = saved.length + " guardadas";
    var list = document.getElementById("focus-list");
    list.innerHTML = "";
    if (!saved.length) {
      var e = document.createElement("li"); e.className = "empty";
      e.textContent = "Aún no guardas titulares. Toca la ☆ en cualquier noticia para guardarla aquí.";
      list.appendChild(e);
    } else {
      saved.forEach(function (it) { list.appendChild(headlineLi(it)); });
    }
    document.getElementById("focus-chart-wrap").hidden = true;
    if (window.Charts) Charts.dispose("focus-chart");
    showOverlay();
  }

  function closeFocus() {
    var f = document.getElementById("focus");
    if (!f || f.hidden) return;
    f.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(function () {
      f.hidden = true;
      if (window.Charts) Charts.dispose("focus-chart");
      renderBeats();          // refresca estados de leído/guardado al volver
      updateSavedCount();
    }, 180);
  }

  /* ---------- ajustes (mostrar/ocultar secciones) ---------- */
  function renderSettings() {
    var pop = document.getElementById("settings-pop");
    if (!pop || !_news) return;
    pop.innerHTML = '<div class="sp-title">Mostrar secciones</div>';
    _news.beats.forEach(function (b) {
      var row = document.createElement("label");
      row.className = "sp-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !(window.UserStore && window.UserStore.isHidden(b.id));
      cb.addEventListener("change", function () {
        if (window.UserStore) window.UserStore.toggleBeat(b.id);
        renderBeats();
      });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(" " + b.name));
      pop.appendChild(row);
    });
  }

  function updateSavedCount() {
    var el = document.getElementById("saved-count");
    if (el && window.UserStore) el.textContent = window.UserStore.savedCount();
  }

  return {
    renderBeats: renderBeats, renderMarkets: renderMarkets, buildTicker: buildTicker,
    renderHot: renderHot, renderSettings: renderSettings, updateSavedCount: updateSavedCount,
    setFilter: setFilter, setSearch: setSearch,
    openFocus: openFocus, openSaved: openSaved, closeFocus: closeFocus, timeAgo: timeAgo
  };
})();
