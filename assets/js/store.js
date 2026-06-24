/* store.js — preferencias persistentes del usuario (localStorage) */
window.UserStore = (function () {
  "use strict";
  var LS = window.localStorage;

  function get(key, def) {
    try { var v = JSON.parse(LS.getItem(key)); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function set(key, val) { try { LS.setItem(key, JSON.stringify(val)); } catch (e) {} }

  var read = new Set(get("nd_read", []));
  var saved = get("nd_saved", []);          // [{link,title,source,image,ts,beat}]
  var hidden = new Set(get("nd_hidden", [])); // beats ocultos
  var prevVisit = get("nd_lastvisit", 0);     // última visita previa (para "nuevas")
  set("nd_lastvisit", Date.now());

  return {
    isRead: function (l) { return read.has(l); },
    markRead: function (l) { read.add(l); set("nd_read", Array.from(read).slice(-3000)); },

    isSaved: function (l) { return saved.some(function (s) { return s.link === l; }); },
    toggleSave: function (item) {
      var i = -1;
      for (var k = 0; k < saved.length; k++) if (saved[k].link === item.link) { i = k; break; }
      if (i >= 0) saved.splice(i, 1); else saved.unshift(item);
      set("nd_saved", saved.slice(0, 500));
      return i < 0; // true si quedó guardado
    },
    savedList: function () { return saved.slice(); },
    savedCount: function () { return saved.length; },

    isHidden: function (b) { return hidden.has(b); },
    toggleBeat: function (b) {
      if (hidden.has(b)) hidden.delete(b); else hidden.add(b);
      set("nd_hidden", Array.from(hidden));
    },

    isNew: function (ts) { return prevVisit > 0 && ts > prevVisit; }
  };
})();
