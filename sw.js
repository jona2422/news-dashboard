/* sw.js — service worker de NEWSDESK
   Shell cache-first (offline instantáneo); data network-first con fallback a caché.
   Rutas relativas: funciona como project page (/news-dashboard/). */
"use strict";

var VERSION = "newsdesk-v2";

// mismo origen: deben cachearse en la instalación
var SHELL_LOCAL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "assets/icon.svg",
  "assets/css/styles.css",
  "assets/js/store.js",
  "assets/js/render.js",
  "assets/js/charts.js",
  "assets/js/palette.js",
  "assets/js/app.js",
  "assets/geo/world.json"
];
// externo (ECharts): se intenta cachear, pero no debe romper la instalación
var ECHARTS = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";

self.addEventListener("install", function (e) {
  e.waitUntil((async function () {
    var c = await caches.open(VERSION);
    await c.addAll(SHELL_LOCAL);
    try { await c.add(ECHARTS); } catch (_) { /* offline al instalar: se cachea luego */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var isData = url.pathname.indexOf("/data/") >= 0 && url.pathname.indexOf(".json") >= 0;

  if (isData) {
    // network-first: siempre intenta datos frescos; si no hay red, usa el último cacheado.
    // ignoreSearch porque la app agrega ?t=timestamp en cada carga.
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true });
      })
    );
    return;
  }

  // shell: stale-while-revalidate — sirve del caché al instante pero se
  // actualiza en segundo plano, así los cambios de código se propagan solos
  // y una versión rota nunca se queda pegada.
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok && url.origin === location.origin) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});
