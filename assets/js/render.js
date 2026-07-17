/* render.js — noticias, KPIs, mercados, ticker, filtros, clima, geo y modo enfoque */

/* Color de identidad de cada sección (compartido con charts.js) */
window.BeatTheme = {
  musica: "#ff5ea8",
  arte: "#a468ff",
  tech: "#3aa0ff",
  actualidad: "#2bd4a8",
  panama_latam: "#ffd23e",
  desastres: "#ff7a45",
  medio_oriente: "#ff4d5e",
  china: "#22d3ee"
};

window.Render = (function () {
  "use strict";

  var _news = null;
  var _markets = null;
  var _geo = null;
  var _mktSel = null;                 // instrumento seleccionado en el histórico
  var filter = { q: "", time: 0, source: "" };
  var FALLBACK = ["#3aa0ff", "#2bd4a8", "#ffb000", "#ff7a45", "#ff4d5e", "#a468ff"];

  var FOCUS_CHART = {
    desastres: { type: "map", title: "Sismos en vivo · USGS (24h)" },
    actualidad: { type: "ind", idx: 1, title: "Crecimiento del PIB (%) · Banco Mundial" },
    china: { type: "ind", idx: 1, title: "Crecimiento del PIB (%) · Banco Mundial" }
  };

  /* ---------- helpers ---------- */
  function escapeHtml(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  function beatColor(id, i) {
    return window.BeatTheme[id] || FALLBACK[(i || 0) % FALLBACK.length];
  }
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
  function sparkline(vals, color, w, h) {
    if (!vals || vals.length < 2) return "";
    w = w || 64; h = h || 26;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var pts = vals.map(function (v, i) {
      return ((i / (vals.length - 1)) * w).toFixed(1) + "," +
        (h - ((v - min) / span) * (h - 2) - 1).toFixed(1);
    }).join(" ");
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" ' +
      'stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function metaLine(it) {
    var dup = (it.count && it.count > 1)
      ? '<span class="hl-dup" title="' + it.count + ' fuentes cubren esto">▣ ' + it.count + "</span>" : "";
    return '<span class="hl-meta"><span class="src">' + escapeHtml(it.source || host(it.link)) +
      '</span><span class="ago">' + timeAgo(it.ts) + "</span>" + dup + "</span>";
  }

  /* ---------- personalización + micro-animaciones ---------- */
  var ACCENTS = [
    { name: "Verde", v: "" },        // por defecto (--accent original)
    { name: "Azul", v: "#3aa0ff" },
    { name: "Ámbar", v: "#ffb000" },
    { name: "Rosa", v: "#ff5ea8" },
    { name: "Violeta", v: "#a468ff" }
  ];
  var _kpiPrev = {};   // último valor numérico por KPI (para el count-up)

  function reduceMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function hexA(hex, a) {
    var h = (hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function tween(from, to, ms, step) {
    var t0 = performance.now();
    function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      var e = 1 - Math.pow(1 - p, 3);            // easeOutCubic
      step(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function numSpan(key, val) {
    return '<span class="kv-num" data-anim="' + key + '" data-to="' + val + '">' +
      Number(val).toLocaleString("en-US") + "</span>";
  }
  function runCounts(root) {
    root.querySelectorAll(".kv-num").forEach(function (el) {
      var key = el.dataset.anim, to = parseFloat(el.dataset.to) || 0;
      var from = _kpiPrev[key] == null ? 0 : _kpiPrev[key];
      _kpiPrev[key] = to;
      if (reduceMotion() || from === to) { el.textContent = Math.round(to).toLocaleString("en-US"); return; }
      tween(from, to, 650, function (v) { el.textContent = Math.round(v).toLocaleString("en-US"); });
    });
  }
  // valor de un campo de history.json ~24h atrás (o null si no hay dato fiable)
  function past24(state, field) {
    var recs = state.history && state.history.records;
    if (!recs || !recs.length) return null;
    var target = Date.now() - 24 * 3600000, best = null, bd = Infinity;
    recs.forEach(function (r) { var d = Math.abs(r.t - target); if (d < bd) { bd = d; best = r; } });
    if (!best || (Date.now() - best.t) < 12 * 3600000) return null;  // exige >=12h de historia
    return best[field] == null ? null : best[field];
  }
  function deltaTxt(cur, past) {
    if (past == null || past === 0) return null;
    var pct = (cur - past) / past * 100;
    if (!isFinite(pct)) return null;
    return {
      txt: (pct >= 0 ? "▲ +" : "▼ ") + Math.abs(pct).toFixed(0) + "% vs 24h",
      cls: pct > 0.5 ? "up" : pct < -0.5 ? "down" : ""
    };
  }

  function applyPrefs() {
    var US = window.UserStore;
    var root = document.documentElement;
    if (!US) return;
    var ac = US.getAccent();
    if (ac) {
      root.style.setProperty("--accent", ac);
      root.style.setProperty("--glow", "0 0 .6rem " + hexA(ac, .5));
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--glow");
    }
    document.body.classList.toggle("compact", US.getCompact());
    if (window.Charts) Charts.resize();
  }

  /* ---------- saludo personalizado ---------- */
  function renderGreet() {
    var el = document.getElementById("greet");
    if (!el) return;
    var h = parseInt(new Date().toLocaleTimeString("es-PA", {
      hour: "2-digit", hour12: false, timeZone: "America/Panama"
    }), 10);
    var g = h < 12 ? "buenos días" : h < 19 ? "buenas tardes" : "buenas noches";
    var fecha = new Date().toLocaleDateString("es-PA", {
      weekday: "long", day: "numeric", month: "long", timeZone: "America/Panama"
    });
    el.textContent = "// " + g + ", Jonathan · " + fecha;
  }

  /* ---------- una noticia (tarjeta) reutilizable ---------- */
  function headlineLi(it) {
    var US = window.UserStore;
    var li = document.createElement("li");
    li.className = "hl";
    if (US && US.isRead(it.link)) li.classList.add("read");

    var a = document.createElement("a");
    a.className = "hl-link"; a.href = it.link; a.target = "_blank"; a.rel = "noopener";

    if (it.image) {
      var th = document.createElement("div");
      th.className = "hl-thumb";
      th.style.backgroundImage = "url('" + String(it.image).replace(/'/g, "%27") + "')";
      a.appendChild(th);
    }

    var dot = (US && US.isNew(it.ts)) ? '<span class="fresh-dot" title="nueva"></span>' : "";
    var txt = document.createElement("div");
    txt.className = "hl-text";
    txt.innerHTML = '<span class="hl-title">' + dot + escapeHtml(it.title) + "</span>" + metaLine(it);
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

  /* ---------- franja de KPIs ---------- */
  function kpiTile(label, value, sub, subCls, spark) {
    return '<div class="kpi"><span class="kpi-label">' + label + '</span>' +
      '<span class="kpi-value">' + value + "</span>" +
      (sub ? '<span class="kpi-sub ' + (subCls || "") + '">' + sub + "</span>" : "") +
      (spark || "") + "</div>";
  }

  function renderKpis(state) {
    var root = document.getElementById("kpis");
    if (!root) return;
    var t = [];
    var US = window.UserStore;

    if (state.weather && state.weather.current) {
      var c = state.weather.current;
      var ic = wmo(c.code);
      t.push(kpiTile("Panamá ahora", ic[0] + " " + c.temp + '<span class="u">°C</span>',
        "sensación " + c.feels + "°"));
    }
    if (state.news) {
      var total = 0, fresh = 0;
      state.news.beats.forEach(function (b) {
        b.items.forEach(function (it) { total++; if (US && US.isNew(it.ts)) fresh++; });
      });
      var nd = deltaTxt(total, past24(state, "news_total"));
      var nSub = fresh ? fresh + " nuevas para ti" : (nd ? nd.txt : "al día");
      var nCls = fresh ? "up" : (nd ? nd.cls : "");
      t.push(kpiTile("Titulares", numSpan("news", total), nSub, nCls));
    }
    if (state.geo) {
      t.push(kpiTile("El mundo hoy", numSpan("countries", (state.geo.countries || []).length) + '<span class="u">países</span>',
        state.geo.total + " menciones"));
    }
    if (state.quakes) {
      var qd = deltaTxt(state.quakes.count, past24(state, "quake_count"));
      var qSub = "máx M" + state.quakes.max + (qd ? " · " + qd.txt.replace(" vs 24h", "") : "");
      t.push(kpiTile("Sismos 24h", numSpan("quakes", state.quakes.count),
        qSub, state.quakes.max >= 6 ? "down" : ""));
    }
    ["S&P 500", "Bitcoin", "EUR/USD"].forEach(function (lbl) {
      var m = state.markets && (state.markets.items || []).find(function (x) { return x.label === lbl; });
      if (!m) return;
      var pct = m.changePct || 0;
      var dir = pct > 0.001 ? "up" : pct < -0.001 ? "down" : "";
      var col = dir === "up" ? "#34e3b6" : dir === "down" ? "#ff5c6e" : "#6f819c";
      t.push(kpiTile(lbl, fmtPrice(m.price),
        (pct >= 0 ? "▲ +" : "▼ ") + Math.abs(pct).toFixed(2) + "%", dir,
        sparkline(m.spark, col, 56, 22)));
    });
    if (state.meta) {
      var okN = state.meta.sources_ok, totN = state.meta.sources_total;
      t.push(kpiTile("Fuentes", numSpan("sources", okN) + '<span class="u">/' + totN + "</span>",
        okN === totN ? "todas activas" : (totN - okN) + " caídas", okN === totN ? "up" : "down"));
    }
    root.innerHTML = t.join("");
    runCounts(root);
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

    // las secciones fijadas van primero (en el orden en que se fijaron)
    var ordered = _news.beats.slice();
    if (US) {
      var pins = US.pinnedList();
      ordered.sort(function (a, b) {
        var ra = pins.indexOf(a.id), rb = pins.indexOf(b.id);
        ra = ra < 0 ? 999 : ra; rb = rb < 0 ? 999 : rb;
        if (ra !== rb) return ra - rb;
        return _news.beats.indexOf(a) - _news.beats.indexOf(b);
      });
    }

    ordered.forEach(function (b, bi) {
      var shown = b.items.filter(matches);
      var newCount = US ? b.items.filter(function (it) { return US.isNew(it.ts); }).length : 0;
      var col = beatColor(b.id, bi);

      if (nav) {
        var a = document.createElement("a");
        a.href = "#";
        a.style.setProperty("--beat", col);
        a.innerHTML = escapeHtml(b.name) + '<span class="n">' + shown.length + "</span>" +
          (newCount ? '<span class="nav-new">' + newCount + "</span>" : "");
        a.addEventListener("click", function (e) { e.preventDefault(); openFocus(b.id); });
        nav.appendChild(a);
      }

      if (US && US.isHidden(b.id)) return;

      var card = document.createElement("article");
      card.className = "panel beat"; card.id = "beat-" + b.id;
      if (US && US.isPinned(b.id)) card.classList.add("pinned");
      card.style.setProperty("--beat", col);
      var head = document.createElement("div");
      head.className = "panel-head"; head.title = "Abrir a pantalla completa";
      head.innerHTML = "<h2>" + escapeHtml(b.name) + "</h2>" +
        (US && US.isPinned(b.id) ? '<span class="pin-badge" title="fijada">📌</span>' : "") +
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

  /* ---------- portada: lo más importante (lista jerárquica) ---------- */
  function renderPortada(news) {
    if (news) _news = news;
    var root = document.getElementById("portada");
    if (!root || !_news) return;
    var US = window.UserStore;

    var ALERT = /gdacs|usgs|earthquake|sismo/i;
    var pool = [];
    _news.beats.forEach(function (b, bi) {
      if (US && US.isHidden(b.id)) return;
      b.items.forEach(function (it) {
        if (ALERT.test(it.source || "") || ALERT.test(it.title || "")) return;
        pool.push({
          link: it.link, title: it.title, source: it.source, image: it.image,
          ts: it.ts, count: it.count || 1, beatId: b.id, beatName: b.name,
          color: beatColor(b.id, bi)
        });
      });
    });

    var now = Date.now();
    pool.forEach(function (it) {
      var ageH = it.ts ? (now - it.ts) / 3600000 : 999;
      var recency = Math.max(0, 48 - ageH) / 48;
      var coverage = Math.min(it.count, 6) - 1;
      it._score = coverage * 2.2 + recency * 2.4 + (it.image ? 0.6 : 0);
    });
    pool.sort(function (a, b) { return b._score - a._score || b.ts - a.ts; });

    var picked = [], perBeat = {};
    for (var i = 0; i < pool.length && picked.length < 10; i++) {
      var it = pool[i];
      perBeat[it.beatId] = (perBeat[it.beatId] || 0);
      if (perBeat[it.beatId] >= 3) continue;
      perBeat[it.beatId]++;
      picked.push(it);
    }
    var leadIdx = picked.findIndex(function (x) { return x.image; });
    if (leadIdx > 0) picked.unshift(picked.splice(leadIdx, 1)[0]);

    root.innerHTML = "";
    if (!picked.length) {
      root.innerHTML = '<li class="empty">Sin titulares por ahora.</li>';
      return;
    }
    picked.forEach(function (it, i) {
      var li = document.createElement("li");
      li.className = "lead" + (i === 0 && it.image ? " first" : "");
      li.style.setProperty("--beat", it.color);
      if (US && US.isRead(it.link)) li.classList.add("read");
      var dot = (US && US.isNew(it.ts)) ? '<span class="fresh-dot"></span>' : "";
      var thumb = (i === 0 && it.image)
        ? '<div class="lead-thumb" style="background-image:url(\'' + String(it.image).replace(/'/g, "%27") + '\')"></div>' : "";
      li.innerHTML = '<a href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener">' +
        thumb +
        '<span class="lead-kick"><span class="lead-beat">' + escapeHtml(it.beatName) + "</span></span>" +
        '<span class="lead-title">' + dot + escapeHtml(it.title) + "</span>" +
        metaLine(it) + "</a>";
      li.querySelector("a").addEventListener("click", function () {
        if (US) US.markRead(it.link); li.classList.add("read");
      });
      root.appendChild(li);
    });
  }

  /* ---------- mercados: heatmap de rendimiento ---------- */
  function heatBg(pct) {
    if (pct == null) return "";
    var a = Math.min(Math.abs(pct) / 3, 1) * 0.5;
    if (Math.abs(pct) < 0.001) return "";
    return pct > 0
      ? "background: linear-gradient(180deg, rgba(43,212,168," + (a * 0.75).toFixed(3) + "), rgba(43,212,168," + (a * 0.25).toFixed(3) + "));"
      : "background: linear-gradient(180deg, rgba(255,77,94," + (a * 0.75).toFixed(3) + "), rgba(255,77,94," + (a * 0.25).toFixed(3) + "));";
  }

  function renderMarkets(markets) {
    if (markets) _markets = markets;
    var root = document.getElementById("markets");
    if (!root || !_markets) return;
    root.innerHTML = "";
    (_markets.items || []).forEach(function (m) {
      var pct = m.changePct || 0;
      var dir = pct > 0.001 ? "up" : pct < -0.001 ? "down" : "flat";
      var arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
      var color = dir === "up" ? "#34e3b6" : dir === "down" ? "#ff5c6e" : "#6f819c";
      var chgTxt = (m.spark && m.spark.length) ? arrow + " " + Math.abs(pct).toFixed(2) + "%" : "spot";
      var el = document.createElement("div");
      el.className = "mkt";
      el.style.cssText = heatBg((m.spark && m.spark.length) ? pct : null);
      el.innerHTML =
        '<span class="label">' + escapeHtml(m.label) + "</span>" +
        '<span class="price">' + fmtPrice(m.price) + "</span>" +
        '<span class="chg ' + dir + '">' + chgTxt + "</span>" + sparkline(m.spark, color);
      root.appendChild(el);
    });
  }

  /* ---------- mercados laterales (hero) + tabs del histórico ---------- */
  function selectMarket(label) {
    if (!_markets) return;
    var m = (_markets.items || []).find(function (x) { return x.label === label && x.hist; });
    if (!m) return;
    _mktSel = label;
    document.querySelectorAll(".mkt-tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.m === label);
    });
    if (window.Charts) Charts.mountMarketBig("mktbig", m);
  }

  function renderMarketTabs() {
    var root = document.getElementById("mkt-tabs");
    if (!root || !_markets) return;
    var withHist = (_markets.items || []).filter(function (m) { return m.hist && m.hist.v && m.hist.v.length > 2; });
    if (!withHist.length) return;
    root.innerHTML = "";
    withHist.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "mkt-tab"; b.dataset.m = m.label;
      b.textContent = m.label;
      b.addEventListener("click", function () { selectMarket(m.label); });
      root.appendChild(b);
    });
    selectMarket(_mktSel && withHist.some(function (m) { return m.label === _mktSel; })
      ? _mktSel : withHist[0].label);
  }

  function renderSideMarkets() {
    var root = document.getElementById("side-mkts");
    if (!root || !_markets) return;
    root.innerHTML = "";
    (_markets.items || []).forEach(function (m) {
      var pct = m.changePct || 0;
      var dir = pct > 0.001 ? "up" : pct < -0.001 ? "down" : "flat";
      var color = dir === "up" ? "#34e3b6" : dir === "down" ? "#ff5c6e" : "#6f819c";
      var row = document.createElement("button");
      row.type = "button"; row.className = "smk"; row.title = "Ver histórico";
      row.innerHTML = '<span class="l">' + escapeHtml(m.label) + "</span>" +
        sparkline(m.spark, color, 54, 20) +
        '<span class="p">' + fmtPrice(m.price) + "</span>" +
        '<span class="c ' + dir + '">' + (m.spark && m.spark.length
          ? (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%" : "spot") + "</span>";
      row.addEventListener("click", function () {
        selectMarket(m.label);
        var big = document.getElementById("mktbig");
        if (big) big.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      root.appendChild(row);
    });
  }

  function buildTicker(markets, quakes, geo) {
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
    if (geo && geo.countries && geo.countries.length) {
      var g = geo.countries[0];
      parts.push('<span class="ticker-item"><b>🌍 ' + escapeHtml(g.es) + "</b> domina los titulares (" + g.count + " menciones)</span>");
    }
    track.innerHTML = parts.length ? parts.join("") + parts.join("") : "";
  }

  /* ---------- ranking de países (junto al mapa) ---------- */
  function renderGeoRank(geo) {
    if (geo) _geo = geo;
    var root = document.getElementById("geo-rank");
    var meta = document.getElementById("geo-meta");
    if (!_geo) return;
    var cs = _geo.countries || [];
    if (meta) meta.textContent = cs.length + " países · " + _geo.total + " menciones";
    if (!root) return;
    root.innerHTML = "";
    var max = Math.max.apply(null, cs.map(function (c) { return c.count; }).concat([1]));
    cs.slice(0, 18).forEach(function (c, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "gr-item"; b.title = "Ver titulares de " + c.es;
      b.innerHTML = '<span class="gr-n">' + (i + 1) + "</span>" +
        '<span class="gr-name">' + escapeHtml(c.es) + "</span>" +
        '<span class="gr-bar" style="width:' + Math.max(4, (c.count / max) * 46) + 'px"></span>' +
        '<span class="gr-count">' + c.count + "</span>";
      b.addEventListener("click", function () { openCountry(c); });
      root.appendChild(b);
    });
  }

  /* ---------- clima ---------- */
  function wmo(code) {
    var T = {
      0: ["☀", "Despejado"], 1: ["🌤", "Mayorm. despejado"], 2: ["⛅", "Parc. nublado"],
      3: ["☁", "Nublado"], 45: ["🌫", "Niebla"], 48: ["🌫", "Niebla"],
      51: ["🌦", "Llovizna"], 53: ["🌦", "Llovizna"], 55: ["🌦", "Llovizna"],
      61: ["🌧", "Lluvia"], 63: ["🌧", "Lluvia"], 65: ["🌧", "Lluvia fuerte"],
      66: ["🌧", "Lluvia helada"], 67: ["🌧", "Lluvia helada"],
      71: ["🌨", "Nieve"], 73: ["🌨", "Nieve"], 75: ["🌨", "Nieve"], 77: ["🌨", "Nieve"],
      80: ["🌦", "Chubascos"], 81: ["🌦", "Chubascos"], 82: ["⛈", "Chubascos fuertes"],
      85: ["🌨", "Nieve"], 86: ["🌨", "Nieve"],
      95: ["⛈", "Tormenta"], 96: ["⛈", "Tormenta granizo"], 99: ["⛈", "Tormenta granizo"]
    };
    return T[code] || ["🌡", "—"];
  }
  function dayName(dateStr) {
    var d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("es", { weekday: "short" }).replace(".", "");
  }
  function renderWeather(w) {
    var root = document.getElementById("weather");
    var mini = document.getElementById("wx-mini");
    if (!w || !w.current) return;
    var c = w.current, ic = wmo(c.code);
    if (mini) mini.innerHTML = ic[0] + " " + c.temp + "° PTY";

    if (!root) return;
    var days = (w.daily || []).map(function (d, i) {
      var di = wmo(d.code);
      var label = i === 0 ? "Hoy" : dayName(d.date);
      var pop = (d.pop != null) ? '<span class="wx-pop">💧' + d.pop + "%</span>" : "";
      return '<div class="wx-day"><span class="wx-dn">' + label + "</span>" +
        '<span class="wx-di" title="' + di[1] + '">' + di[0] + "</span>" +
        '<span class="wx-dt"><b>' + d.tmax + "°</b> " + d.tmin + "°</span>" + pop + "</div>";
    }).join("");

    var extra = "";
    if (c.uv != null) extra += "<span>UV <b>" + c.uv + "</b></span>";
    if (w.sunrise && w.sunset) extra += "<span>☀ <b>" + w.sunrise + "</b> → <b>" + w.sunset + "</b></span>";

    root.innerHTML =
      '<div class="wx-now">' +
        '<span class="wx-ico">' + ic[0] + "</span>" +
        '<div class="wx-main"><span class="wx-temp">' + c.temp + "°</span>" +
        '<span class="wx-desc">' + ic[1] + "</span></div>" +
        '<div class="wx-stats">' +
          '<span>Sensación <b>' + c.feels + "°</b></span>" +
          '<span>Humedad <b>' + (c.humidity != null ? c.humidity + "%" : "—") + "</b></span>" +
          '<span>Viento <b>' + c.wind + " km/h</b></span>" + extra +
        "</div>" +
      "</div>" +
      '<div id="wxhours" class="wx-hours"></div>' +
      '<div class="wx-days">' + days + "</div>";

    if (window.Charts) Charts.mountWxHours("wxhours", w);
  }

  /* ---------- salud de fuentes ---------- */
  function renderHealth(meta) {
    var root = document.getElementById("health");
    if (!root || !meta) return;
    var feeds = meta.feeds || [];
    var down = feeds.filter(function (f) { return !f.ok; });
    var ok = meta.sources_ok != null ? meta.sources_ok : (feeds.length - down.length);
    var total = meta.sources_total != null ? meta.sources_total : feeds.length;
    var cls = down.length === 0 ? "good" : "warn";
    var txt = '<span class="health-dot ' + cls + '"></span>' +
      ok + "/" + total + " fuentes activas";
    if (down.length) {
      txt += ' · <span class="health-down">⚠ ' + down.length + " caída" +
        (down.length > 1 ? "s" : "") + ": " +
        down.map(function (f) { return escapeHtml(f.source); }).join(", ") + "</span>";
    }
    root.innerHTML = txt;
  }

  /* ---------- carril "en desarrollo" (cobertura amplia = proxy de breaking) ---------- */
  function renderDeveloping() {
    var root = document.getElementById("developing");
    if (!root || !_news) return;
    var US = window.UserStore;
    var ALERT = /gdacs|usgs|earthquake|sismo|reliefweb/i;   // alertas automáticas, no "breaking"
    var pool = [];
    _news.beats.forEach(function (b, bi) {
      if (US && US.isHidden(b.id)) return;
      b.items.forEach(function (it) {
        if (ALERT.test(it.source || "") || ALERT.test(it.title || "")) return;
        if ((it.count || 1) >= 2) {
          pool.push({
            link: it.link, title: it.title, source: it.source, ts: it.ts,
            count: it.count, beatName: b.name, color: beatColor(b.id, bi)
          });
        }
      });
    });
    var now = Date.now();
    pool.forEach(function (it) {
      var ageH = it.ts ? (now - it.ts) / 3600000 : 999;
      var recency = Math.max(0, 36 - ageH) / 36;
      it._score = (it.count - 1) * 2 + recency * 1.5;
    });
    pool.sort(function (a, b) { return b._score - a._score || b.ts - a.ts; });
    var picked = pool.slice(0, 8);
    if (!picked.length) { root.innerHTML = ""; return; }

    var html = '<span class="dev-label">⚡ En desarrollo</span>';
    picked.forEach(function (it) {
      html += '<a class="dev-card" href="' + escapeHtml(it.link) + '" target="_blank" rel="noopener" style="--beat:' + it.color + '">' +
        '<span class="dev-kick">' + escapeHtml(it.beatName) + '</span>' +
        '<span class="dev-title">' + escapeHtml(it.title) + '</span>' +
        '<span class="dev-meta"><span class="dev-n" title="fuentes que lo cubren">▣ ' + it.count + '</span>' +
        '<span class="dev-src">' + escapeHtml(it.source || "") + '</span>' +
        '<span class="dev-ago">' + timeAgo(it.ts) + '</span></span></a>';
    });
    root.innerHTML = html;
    if (US) Array.prototype.forEach.call(root.querySelectorAll(".dev-card"), function (a, i) {
      a.addEventListener("click", function () { US.markRead(picked[i].link); });
    });
  }

  /* ---------- temas calientes ---------- */
  function renderHot(trends) {
    var root = document.getElementById("hot");
    if (!root) return;
    root.innerHTML = "";
    var items = [];
    var seen = {};
    (trends.entities || []).slice(0, 12).forEach(function (e) {
      items.push({ label: e.name, count: e.count, cls: "ent" });
      e.name.toLowerCase().split(/\s+/).forEach(function (w) { seen[w] = 1; });
    });
    (trends.terms || []).slice(0, 12).forEach(function (t) {
      if (seen[t.term.toLowerCase()]) return;   // ya está como entidad
      items.push({ label: t.term, count: t.count, cls: "term" });
    });
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

  /* ---------- analítica: tu lectura por sección ---------- */
  function renderAnalytics(trends) {
    if (!window.Charts) return;
    var US = window.UserStore;

    if (_news) {
      var rows = [];
      _news.beats.forEach(function (b, bi) {
        var n = 0;
        b.items.forEach(function (it) { if (US && US.isRead(it.link)) n++; });
        if (n) rows.push({ name: b.name, value: n, color: beatColor(b.id, bi) });
      });
      if (!rows.length) {
        // sin lecturas aún: muestra el peso de cobertura de cada sección
        _news.beats.forEach(function (b, bi) {
          var n = 0;
          b.items.forEach(function (it) { n += (it.count || 1); });
          rows.push({ name: b.name, value: n, color: beatColor(b.id, bi) });
        });
        rows._label = "titulares";
      } else {
        rows._label = "leídas";
      }
      Charts.mountReadDonut("readdonut", rows);
    }
    if (trends && trends.entities) {
      Charts.mountEntities("entbar", trends.entities, setSearch);
    }
  }

  /* ---------- overlay (enfoque / guardados / país) ---------- */
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

  function openCountry(c) {
    document.getElementById("focus-title").textContent = "🌍 " + c.es;
    document.getElementById("focus-count").textContent =
      c.count + (c.count === 1 ? " mención hoy" : " menciones hoy");
    var list = document.getElementById("focus-list");
    list.innerHTML = "";
    (c.items || []).forEach(function (it) { list.appendChild(headlineLi(it)); });
    document.getElementById("focus-chart-wrap").hidden = true;
    if (window.Charts) Charts.dispose("focus-chart");
    showOverlay();
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
      renderBeats();
      renderPortada();
      renderAnalytics();
      updateSavedCount();
    }, 180);
  }

  /* ---------- ajustes (mostrar/ocultar secciones) ---------- */
  function renderSettings() {
    var pop = document.getElementById("settings-pop");
    if (!pop || !_news) return;
    var US = window.UserStore;
    pop.innerHTML = "";

    // ---- apariencia: acento + modo compacto ----
    var appTitle = document.createElement("div");
    appTitle.className = "sp-title"; appTitle.textContent = "Apariencia";
    pop.appendChild(appTitle);

    var sw = document.createElement("div"); sw.className = "sp-swatches";
    ACCENTS.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sw" + (US && US.getAccent() === a.v ? " on" : "");
      b.title = a.name;
      b.style.background = a.v || "#2bd4a8";
      b.addEventListener("click", function () {
        if (US) US.setAccent(a.v);
        applyPrefs(); renderSettings();
      });
      sw.appendChild(b);
    });
    pop.appendChild(sw);

    var cRow = document.createElement("label"); cRow.className = "sp-row";
    var cCb = document.createElement("input"); cCb.type = "checkbox";
    cCb.checked = !!(US && US.getCompact());
    cCb.addEventListener("change", function () {
      if (US) US.setCompact(cCb.checked);
      applyPrefs();
    });
    cRow.appendChild(cCb);
    cRow.appendChild(document.createTextNode(" Modo compacto"));
    pop.appendChild(cRow);

    // ---- secciones: mostrar/ocultar + fijar ----
    var secTitle = document.createElement("div");
    secTitle.className = "sp-title"; secTitle.textContent = "Mostrar secciones";
    pop.appendChild(secTitle);

    _news.beats.forEach(function (b) {
      var row = document.createElement("div");
      row.className = "sp-row sp-beat";

      var lab = document.createElement("label");
      lab.className = "sp-beatlabel";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !(US && US.isHidden(b.id));
      cb.addEventListener("change", function () {
        if (US) US.toggleBeat(b.id);
        renderBeats(); renderPortada();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + b.name));

      var pin = document.createElement("button");
      pin.type = "button";
      pin.className = "sp-pin" + (US && US.isPinned(b.id) ? " on" : "");
      pin.title = "Fijar arriba";
      pin.textContent = (US && US.isPinned(b.id)) ? "★" : "☆";
      pin.addEventListener("click", function (e) {
        e.preventDefault();
        if (US) US.togglePin(b.id);
        var on = US && US.isPinned(b.id);
        pin.classList.toggle("on", on);
        pin.textContent = on ? "★" : "☆";
        renderBeats();
      });

      row.appendChild(lab);
      row.appendChild(pin);
      pop.appendChild(row);
    });
  }

  function updateSavedCount() {
    var el = document.getElementById("saved-count");
    if (el && window.UserStore) el.textContent = window.UserStore.savedCount();
  }

  return {
    renderGreet: renderGreet, renderKpis: renderKpis,
    renderBeats: renderBeats, renderMarkets: renderMarkets, buildTicker: buildTicker,
    renderMarketTabs: renderMarketTabs, renderSideMarkets: renderSideMarkets,
    renderGeoRank: renderGeoRank, renderAnalytics: renderAnalytics,
    renderDeveloping: renderDeveloping, applyPrefs: applyPrefs,
    renderHot: renderHot, renderSettings: renderSettings, updateSavedCount: updateSavedCount,
    renderPortada: renderPortada, renderWeather: renderWeather, renderHealth: renderHealth,
    setFilter: setFilter, setSearch: setSearch,
    openFocus: openFocus, openSaved: openSaved, openCountry: openCountry, closeFocus: closeFocus,
    timeAgo: timeAgo
  };
})();
