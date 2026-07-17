/* palette.js — paleta de comandos (⌘K / Ctrl+K) y atajos de teclado */
window.Palette = (function () {
  "use strict";

  var el, input, listEl, results = [], active = 0, open = false;

  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function isTyping(t) {
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }
  function jump(sel) {
    var t = document.querySelector(sel);
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* construye la lista de comandos según lo que se haya escrito */
  function build(q) {
    var R = window.Render, S = window.Store || {};
    var beats = (S.news && S.news.beats) || [];
    var ql = (q || "").toLowerCase().trim();
    var cmds = [];

    if (ql) {
      cmds.push({ icon: "⌕", label: 'Buscar "' + q + '" en titulares', hint: "búsqueda",
        run: function () { if (R) R.setSearch(q); } });
    }

    var base = [];
    base.push({ icon: "★", label: "Abrir guardados", hint: "acción",
      run: function () { if (R) R.openSaved(); } });
    [
      { l: "Ir a Secciones", s: ".beats" },
      { l: "Ir a Radar sísmico", s: ".latam-row" },
      { l: "Ir a Tablero de datos", s: "#mktbig" },
      { l: "Ir a Analítica", s: "#readdonut" }
    ].forEach(function (j) {
      base.push({ icon: "↧", label: j.l, hint: "navegar", run: function () { jump(j.s); } });
    });
    beats.forEach(function (b) {
      base.push({ icon: "▍", label: "Sección · " + b.name, hint: "abrir",
        run: (function (id) { return function () { if (R) R.openFocus(id); }; })(b.id) });
    });
    base.push({ icon: "⚙", label: "Mostrar / ocultar secciones", hint: "acción",
      run: function () { var s = document.getElementById("settings-btn"); if (s) s.click(); } });

    base.forEach(function (c) {
      if (!ql || c.label.toLowerCase().indexOf(ql) >= 0) cmds.push(c);
    });

    if (ql) {
      var hits = [];
      beats.forEach(function (b) {
        b.items.forEach(function (it) {
          if ((it.title || "").toLowerCase().indexOf(ql) >= 0) {
            hits.push({ icon: "›", label: it.title, hint: b.name,
              run: (function (l) { return function () { window.open(l, "_blank", "noopener"); }; })(it.link) });
          }
        });
      });
      cmds = cmds.concat(hits.slice(0, 6));
    }
    return cmds.slice(0, 12);
  }

  function draw() {
    listEl.innerHTML = "";
    results.forEach(function (c, i) {
      var li = document.createElement("li");
      li.className = "pal-item" + (i === active ? " active" : "");
      li.innerHTML = '<span class="pal-ico">' + c.icon + '</span>' +
        '<span class="pal-label">' + esc(c.label) + '</span>' +
        '<span class="pal-hint">' + esc(c.hint) + '</span>';
      li.addEventListener("mouseenter", function () { active = i; hi(); });
      li.addEventListener("click", function () { run(i); });
      listEl.appendChild(li);
    });
    if (!results.length) {
      listEl.innerHTML = '<li class="pal-empty">Sin coincidencias</li>';
    }
  }
  function hi() {
    Array.prototype.forEach.call(listEl.children, function (li, i) {
      if (li.classList) li.classList.toggle("active", i === active);
    });
    var cur = listEl.children[active];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
  }
  function refresh() { results = build(input.value); active = 0; draw(); }
  function run(i) { var c = results[i]; if (!c) return; close(); c.run(); }

  function openP() {
    if (open || !el) return;
    open = true; el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("open"); });
    input.value = ""; refresh(); input.focus();
  }
  function close() {
    if (!open) return;
    open = false; el.classList.remove("open");
    setTimeout(function () { el.hidden = true; }, 150);
  }
  function toggle() { open ? close() : openP(); }

  function init() {
    el = document.getElementById("palette");
    if (!el) return;
    el.innerHTML =
      '<div class="pal-box" role="dialog" aria-label="Paleta de comandos">' +
        '<input id="pal-input" class="pal-input" type="text" ' +
          'placeholder="Escribe un comando o busca titulares…" autocomplete="off" spellcheck="false">' +
        '<ul id="pal-list" class="pal-list"></ul>' +
        '<div class="pal-foot"><span><b>↑↓</b> navegar</span><span><b>↵</b> abrir</span>' +
          '<span><b>esc</b> cerrar</span></div>' +
      '</div>';
    input = document.getElementById("pal-input");
    listEl = document.getElementById("pal-list");

    var fab = document.getElementById("palette-fab");
    if (fab) fab.addEventListener("click", openP);

    input.addEventListener("input", refresh);
    el.addEventListener("mousedown", function (e) { if (e.target === el) close(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(results.length - 1, active + 1); hi(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); hi(); }
      else if (e.key === "Enter") { e.preventDefault(); run(active); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); toggle(); return;
      }
      if (open || isTyping(e.target)) return;
      var R = window.Render, S = window.Store || {};
      if (e.key === "/") {
        e.preventDefault();
        var qi = document.getElementById("q"); if (qi) qi.focus();
      } else if (e.key === "s") {
        if (R) R.openSaved();
      } else if (e.key === "?") {
        openP();
      } else if (/^[1-8]$/.test(e.key)) {
        var beats = (S.news && S.news.beats) || [];
        var idx = parseInt(e.key, 10) - 1;
        if (beats[idx] && R) R.openFocus(beats[idx].id);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { open: openP, close: close, toggle: toggle };
})();
