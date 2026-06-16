/* =============================================================================
   DSK•LoFi — youtube.js
   Pestaña "Online": búsqueda en YouTube y reproducción de SOLO AUDIO en el
   dispositivo (vía YoutubeBridge / NewPipeExtractor). Sin servidor intermedio.

   - Búsqueda y resolución de audio van por window.DSKYoutube (bridge nativo).
   - La URL de audio caduca → en listas se guarda el videoId y se re-resuelve al
     reproducir (lo hace app.js → loadFile cuando la pista tiene ytId).
   - En navegador/PWA (sin bridge) la pestaña avisa de que solo va en la app.

   API: window.DSKYT.search(query) · window.DSKYT.resolve(videoId)  → Promesas
   ========================================================================== */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const t = (k) => (window.I18n ? I18n.t(k) : k);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const native = () =>
    typeof window.DSKYoutube !== "undefined" &&
    typeof window.DSKYoutube.search === "function";

  /* --------------------- puente nativo (callbacks) -------------------- */
  const pending = {};
  let reqSeq = 0;
  let callbacksReady = false;

  function installCallbacks() {
    if (callbacksReady || !native()) return;
    window.DSKYoutube.__result = function (reqId, json) {
      const p = pending[reqId]; if (!p) return; delete pending[reqId];
      let arr = []; try { arr = JSON.parse(json) || []; } catch (e) { arr = []; }
      p.resolve(arr);
    };
    window.DSKYoutube.__error = function (reqId, code) {
      const p = pending[reqId]; if (!p) return; delete pending[reqId];
      p.reject(code || "network");
    };
    callbacksReady = true;
  }

  function call(method, arg) {
    return new Promise((resolve, reject) => {
      installCallbacks();
      if (!native()) { reject("browser"); return; }
      const reqId = "yt" + (++reqSeq) + "_" + Date.now();
      const to = setTimeout(() => { if (pending[reqId]) { delete pending[reqId]; reject("network"); } }, 25000);
      pending[reqId] = {
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject:  (e) => { clearTimeout(to); reject(e); }
      };
      try { window.DSKYoutube[method](arg, reqId); }
      catch (e) { clearTimeout(to); delete pending[reqId]; reject("network"); }
    });
  }

  const DSKYT = {
    search(query) { return call("search", query); },
    resolve(videoId) { return call("resolveAudio", videoId).then((a) => (a && a[0]) || null); },
    resolvePlaylist(urlOrId) { return call("resolvePlaylist", urlOrId); },
    download(videoId) { return call("downloadAudio", videoId).then((a) => (a && a[0]) || null); }
  };
  window.DSKYT = DSKYT;

  /* ------------------------------- UI -------------------------------- */
  function fmtDur(sec) {
    sec = parseInt(sec, 10);
    if (!isFinite(sec) || sec <= 0) return "";
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m >= 60) { const h = Math.floor(m / 60); return h + ":" + String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0"); }
    return m + ":" + String(s).padStart(2, "0");
  }

  function host() { return $("#ytItems"); }
  function setHost(html) { const h = host(); if (h) h.innerHTML = html; }
  function state(msg) { setHost('<div class="yt-state">' + esc(msg) + "</div>"); const f = $("#ytFoot"); if (f) f.hidden = true; }

  function curVer() {
    try { return (window.DSKYoutube && DSKYoutube.libVersion) ? DSKYoutube.libVersion() : ""; }
    catch (e) { return ""; }
  }
  // Estado inicial: mensaje + versión de NewPipe usada; comprueba online la última.
  function setEmpty() {
    results = []; sel.on = false; sel.ids.clear();
    const foot = $("#ytFoot"); if (foot) foot.hidden = true;
    const cv = curVer();
    setHost('<div class="yt-state">' + esc(t("on_empty")) + "</div>" +
            '<div class="yt-ver" id="ytVer">' + (cv ? esc(t("on_lib_using")) + " " + esc(cv) : "") + "</div>");
    if (cv) checkLatest(cv);
  }
  async function checkLatest(cv) {
    let latest = "", url = "";
    try {
      const r = await fetch("https://api.github.com/repos/TeamNewPipe/NewPipeExtractor/releases/latest",
        { headers: { Accept: "application/vnd.github+json" } });
      if (r.ok) { const j = await r.json(); latest = (j && j.tag_name) ? j.tag_name : ""; url = (j && j.html_url) ? j.html_url : ""; }
    } catch (e) {}
    const el = $("#ytVer"); if (!el || !latest) return;
    if (!url) url = "https://github.com/TeamNewPipe/NewPipeExtractor/releases/tag/" + latest;
    const norm = (s) => String(s).replace(/^v/, "").trim();
    const newer = norm(latest) !== norm(cv);
    el.innerHTML = esc(t("on_lib_using")) + " " + esc(cv) + "<br>" +
      esc(t("on_lib_latest")) + ' <a class="yt-ver__link" data-ext="' + esc(url) + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(latest) + "</a>" +
      (newer ? ' <span class="yt-ver__new">' + esc(t("on_lib_update")) + "</span>" : " ✓");
  }

  // abre un enlace fuera del WebView (navegador del sistema)
  function openExt(url) {
    if (!url) return;
    try { if (window.AndroidFileManager && AndroidFileManager.openExternal) { AndroidFileManager.openExternal(url); return; } } catch (e) {}
    try { if (window.DSKBridge && DSKBridge.openExternal) { DSKBridge.openExternal(url); return; } } catch (e) {}
    try { window.open(url, "_blank", "noopener"); } catch (e) {}
  }

  const IC_DL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 11 5 5 5-5"></path><path d="M5 21h14"></path></svg>';
  const IC_ADD = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
  const IC_CHECK = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

  let results = [];
  const sel = { on: false, ids: new Set() };   // selección múltiple (por videoId)

  function render() {
    if (!results.length) { sel.on = false; sel.ids.clear(); state(t("on_notfound")); return; }
    const selecting = sel.on;
    let h = "";
    results.forEach((r, i) => {
      const sub = [r.uploader, fmtDur(r.duration)].filter(Boolean).join(" · ");
      const checked = selecting && sel.ids.has(r.videoId);
      h += '<div class="yt-row' + (checked ? " yt-row--checked" : "") + '" data-i="' + i + '" data-vid="' + esc(r.videoId) + '">' +
           (r.thumb ? '<img class="yt-row__thumb" src="' + esc(r.thumb) + '" alt="" loading="lazy">' : '<span class="yt-row__thumb"></span>') +
           '<span class="yt-row__main">' +
           '<span class="yt-row__title">' + esc(r.title) + "</span>" +
           '<span class="yt-row__sub">' + esc(sub) + "</span></span>" +
           (selecting
             ? '<span class="yt-row__chk">' + IC_CHECK + "</span>"
             : '<button class="yt-row__act" type="button" data-dl="' + i + '" aria-label="' + esc(t("on_download")) + '">' + IC_DL + "</button>" +
               '<button class="yt-row__act" type="button" data-add="' + i + '" aria-label="' + esc(t("on_add_list")) + '">' + IC_ADD + "</button>") +
           '<div class="yt-row__bar"><span class="yt-row__barfill"></span></div>' +
           "</div>";
    });
    setHost(h);
    updateFoot();
  }

  /* ---- barra inferior fija: todo / selección múltiple ---- */
  function updateFoot() {
    const foot = $("#ytFoot"); if (!foot) return;
    const selecting = sel.on && results.length > 0;
    // footer visible si hay >1 resultado (para "todo") o si estamos seleccionando
    foot.hidden = !(results.length > 1 || selecting);
    const set = (id, show) => { const b = $("#" + id); if (b) b.hidden = !show; };
    set("ytFootCount", selecting);
    set("ytSelectToggle", !selecting);
    set("ytAddAll", !selecting);
    set("ytDlAll", !selecting);
    set("ytSelPlay", selecting);
    set("ytSelAdd", selecting);
    set("ytSelDl", selecting);
    set("ytSelCancel", selecting);
    if (selecting) {
      const c = $("#ytFootCount"); if (c) c.textContent = String(sel.ids.size);
      const dis = sel.ids.size === 0;
      ["ytSelPlay", "ytSelAdd", "ytSelDl"].forEach((id) => { const b = $("#" + id); if (b) b.disabled = dis; });
    }
  }

  function enterSelect(vid) { sel.on = true; if (vid) sel.ids.add(vid); render(); }
  function exitSelect() { sel.on = false; sel.ids.clear(); render(); }
  function toggleSel(vid) {
    if (!vid) return;
    if (sel.ids.has(vid)) sel.ids.delete(vid); else sel.ids.add(vid);
    const row = rowByVid(vid);
    if (row) row.classList.toggle("yt-row--checked", sel.ids.has(vid));
    updateFoot();
  }
  function selectedResults() { return results.filter((r) => sel.ids.has(r.videoId)); }
  function playSelected() {
    const rs = selectedResults(); if (!rs.length || !window.DSKQueue) return;
    DSKQueue.load(rs.map(itemOf), 0, { type: "online", name: "YouTube" });
    exitSelect();
  }
  function addSelectedToList() {
    const rs = selectedResults(); if (!rs.length) return;
    if (window.DSKLists && DSKLists.add) DSKLists.add(rs.map(itemOf));
    else if (window.UI) UI.toast(t("on_browser"));
    exitSelect();
  }
  function downloadSelected() {
    const rs = selectedResults(); if (!rs.length) return;
    if (!(window.DSKDownloads && DSKDownloads.enqueue)) { if (window.UI) UI.toast(t("on_browser")); return; }
    let n = 0;
    rs.forEach((r) => { try { DSKDownloads.enqueue(r.videoId, r.title || "", r.thumb || ""); setBar(r.videoId, 2, false); n++; } catch (e) {} });
    if (window.UI) UI.toast(t("on_dl_all_started").replace("{n}", n));
    exitSelect();
  }

  function itemOf(r) {
    return { name: r.title || "", ytId: r.videoId, uploader: r.uploader || "", thumb: r.thumb || "" };
  }

  function play(i) {
    const r = results[i]; if (!r || !window.DSKQueue) return;
    const items = results.map(itemOf);
    DSKQueue.load(items, i, { type: "online", name: "YouTube" });
  }
  function addToList(i) {
    const r = results[i]; if (!r) return;
    openTrackMenu(r);
  }

  /* ---- menú de opciones (+): siguiente / cola / añadir a lista ---- */
  function openTrackMenu(r) {
    if (!window.UI) return;
    const list = $("#trackMenuList");
    if (!list) return;
    list.innerHTML = "";

    const opts = [
      { key: "yt_play_next", action: () => {
          if (window.DSKQueue && DSKQueue.enqueueNext) DSKQueue.enqueueNext([itemOf(r)]);
          if (window.UI) UI.toast(t("yt_added_next"));
        } },
      { key: "yt_add_queue", action: () => {
          if (window.DSKQueue && DSKQueue.enqueueLast) DSKQueue.enqueueLast([itemOf(r)]);
          if (window.UI) UI.toast(t("yt_added_queue"));
        } },
      { key: "yt_add_playlist", action: () => {
          if (window.DSKLists && DSKLists.add) DSKLists.add(itemOf(r));
        } }
    ];

    opts.forEach((o) => {
      const b = document.createElement("button");
      b.className = "menu-item";
      b.type = "button";
      b.setAttribute("data-i18n", o.key);
      b.textContent = t(o.key);
      b.addEventListener("click", () => {
        UI.closeModal("trackMenuModal");
        o.action();
      });
      list.appendChild(b);
    });

    UI.openModal("trackMenuModal");
  }
  function sanitizeName(s) {
    return String(s == null ? "" : s).replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function clampPcm(s) { s = s < -1 ? -1 : (s > 1 ? 1 : s); return s < 0 ? s * 0x8000 : s * 0x7FFF; }
  function bytesToB64(bytes) {
    let bin = ""; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }

  // ArrayBuffer (webm/opus/m4a…) → Uint8Array MP3 128 kbps usando lame.min (lamejs)
  async function encodeMp3_128(arrayBuffer, onProgress) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw "AudioContext no disponible";
    const ac = new Ctx();
    let audioBuf;
    try { audioBuf = await ac.decodeAudioData(arrayBuffer.slice(0)); }
    finally { try { ac.close(); } catch (e) {} }

    const Lame = window.lamejs || (window.lamejs = window.Lame);
    if (!Lame || !Lame.Mp3Encoder) throw "lame.min no disponible";

    const ch = Math.min(2, audioBuf.numberOfChannels || 1);
    const sr = audioBuf.sampleRate || 44100;
    const enc = new Lame.Mp3Encoder(ch, sr, 128);

    const left = audioBuf.getChannelData(0);
    const right = ch > 1 ? audioBuf.getChannelData(1) : null;
    const len = left.length, block = 1152;
    const l16 = new Int16Array(block), r16 = ch > 1 ? new Int16Array(block) : null;
    const out = [];
    let blk = 0;
    for (let p = 0; p < len; p += block) {
      const n = Math.min(block, len - p);
      for (let j = 0; j < n; j++) {
        l16[j] = clampPcm(left[p + j]);
        if (r16) r16[j] = clampPcm(right[p + j]);
      }
      const mp3 = (ch > 1)
        ? enc.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n))
        : enc.encodeBuffer(l16.subarray(0, n));
      if (mp3.length) out.push(new Uint8Array(mp3));
      if ((++blk) % 50 === 0) {
        if (onProgress) onProgress(p / len);
        await new Promise((res) => setTimeout(res, 0)); // ceder hilo (repinta barra)
      }
    }
    const end = enc.flush();
    if (end.length) out.push(new Uint8Array(end));
    if (onProgress) onProgress(1);

    let total = 0; out.forEach((a) => total += a.length);
    const res = new Uint8Array(total); let off = 0;
    out.forEach((a) => { res.set(a, off); off += a.length; });
    return res;
  }

  /* ---- descarga: 100% nativa (servicio), rápida y con notificación ---- */
  function rowByVid(vid) { const h = host(); return h ? h.querySelector('.yt-row[data-vid="' + vid + '"]') : null; }
  function setBar(vid, pct, keep) {
    const row = rowByVid(vid); if (!row) return;
    const bar = row.querySelector(".yt-row__bar"), fill = row.querySelector(".yt-row__barfill");
    if (bar) bar.classList.add("is-active");
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
    if (keep) setTimeout(() => { if (bar) bar.classList.remove("is-active"); if (fill) fill.style.width = "0%"; }, 800);
  }
  function clearBar(vid) {
    const row = rowByVid(vid); if (!row) return;
    const bar = row.querySelector(".yt-row__bar"), fill = row.querySelector(".yt-row__barfill");
    if (bar) bar.classList.remove("is-active"); if (fill) fill.style.width = "0%";
  }
  function installDlCallbacks() {
    if (!window.DSKDownloads) return;
    DSKDownloads.__p = function (vid, pct) { setBar(vid, pct, false); };
    DSKDownloads.__done = function (vid, name) { setBar(vid, 100, true); if (window.UI) UI.toast(t("on_downloaded") + ": " + name); };
    DSKDownloads.__err = function (vid, msg) { clearBar(vid); if (window.UI) UI.toast(t("on_dl_error") + (msg ? " — " + msg : "")); };
  }
  function enqueueDownload(i) {
    const r = results[i]; if (!r) return;
    if (!(window.DSKDownloads && DSKDownloads.enqueue)) { if (window.UI) UI.toast(t("on_browser")); return; }
    try { DSKDownloads.enqueue(r.videoId, r.title || "", r.thumb || ""); }
    catch (e) { if (window.UI) UI.toast(t("on_dl_error")); return; }
    setBar(r.videoId, 2, false);
    if (window.UI) UI.toast(t("on_queued"));
  }

  // Descargas en lote: encola TODOS los resultados obtenidos.
  function batchDownload() {
    if (!results.length) return;
    if (!(window.DSKDownloads && DSKDownloads.enqueue)) { if (window.UI) UI.toast(t("on_browser")); return; }
    let n = 0;
    results.forEach((r) => {
      if (!r || !r.videoId) return;
      try { DSKDownloads.enqueue(r.videoId, r.title || "", r.thumb || ""); setBar(r.videoId, 2, false); n++; }
      catch (e) {}
    });
    if (window.UI) UI.toast(t("on_dl_all_started").replace("{n}", n));
  }

  // Añadir todos los resultados a una lista (abre el selector de lista de la app).
  function addAll() {
    if (!results.length) return;
    if (window.DSKLists && DSKLists.add) DSKLists.add(results.map(itemOf));
    else if (window.UI) UI.toast(t("on_browser"));
  }

  // Detecta y extrae el ID de vídeo de una URL de YouTube en sus formas comunes:
  //   youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /v/ID, /live/ID
  //   con cualquier parámetro extra (?si=, &t=, &list=…) y dominios .com/.es/… o music.
  // Devuelve el ID (11 chars) o null si no es una URL de YouTube reconocible.
  function parseYouTubeId(str) {
    const s = (str || "").trim();
    if (!s) return null;
    // ¿parece una URL/dominio de youtube? (evita tratar texto normal como enlace)
    if (!/(?:youtu\.be|youtube\.com|youtube-nocookie\.com|music\.youtube\.[a-z.]+|youtube\.[a-z.]+)/i.test(s)) return null;
    const ID = /^[A-Za-z0-9_-]{11}$/;
    let m;
    // youtu.be/ID
    m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);          if (m && ID.test(m[1])) return m[1];
    // watch?v=ID
    m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);                if (m && ID.test(m[1])) return m[1];
    // /shorts/ID , /embed/ID , /v/ID , /live/ID
    m = s.match(/\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/); if (m && ID.test(m[1])) return m[1];
    return null;
  }

  // Resuelve una URL de YouTube → muestra ESE único vídeo como resultado.
  // Detecta el ID de una lista de reproducción en una URL de YouTube (list=…).
  function parseYouTubePlaylistId(str) {
    const s = (str || "").trim();
    if (!s) return null;
    if (!/(?:youtu\.be|youtube\.com|music\.youtube\.[a-z.]+|youtube\.[a-z.]+)/i.test(s)) return null;
    const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
    if (m && m[1] && !/^WL$/i.test(m[1])) return m[1]; // WL = "Ver más tarde" (privada)
    return null;
  }

  // Carga una lista de reproducción completa en los resultados.
  async function openPlaylist(arg) {
    state(t("on_playlist_loading"));
    try {
      const arr = await DSKYT.resolvePlaylist(arg);
      if (!arr || !arr.length) { results = []; state(t("on_notfound")); return; }
      results = arr.map((r) => ({
        videoId: r.videoId,
        title: r.title || r.videoId,
        uploader: r.uploader || "",
        duration: r.duration || 0,
        thumb: r.thumb || ("https://i.ytimg.com/vi/" + r.videoId + "/hqdefault.jpg")
      }));
      render();
    } catch (code) {
      results = [];
      if (code === "browser") state(t("on_browser"));
      else state(t("on_error"));
    }
  }

  async function openByUrl(videoId) {
    state(t("on_searching"));
    try {
      const info = await DSKYT.resolve(videoId);
      if (!info) { results = []; state(t("on_notfound")); return; }
      results = [{
        videoId: videoId,
        title: info.title || videoId,
        uploader: info.uploader || "",
        duration: info.duration || 0,
        thumb: info.thumb || ("https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg")
      }];
      render();
    } catch (code) {
      results = [];
      if (code === "browser") state(t("on_browser"));
      else state(t("on_error"));
    }
  }

  async function run(query) {
    query = (query || "").trim();
    if (!query) return;
    sel.on = false; sel.ids.clear();   // nueva búsqueda → salir de selección
    // ¿es una URL de YouTube? → abrir ese vídeo como resultado único
    const vid = parseYouTubeId(query);
    const plid = parseYouTubePlaylistId(query);
    // lista de reproducción (sin vídeo concreto) → cargar la lista entera
    if (plid && !vid) { openPlaylist(query); return; }
    if (vid) { openByUrl(vid); return; }
    state(t("on_searching"));
    try {
      results = await DSKYT.search(query);
      render();
    } catch (code) {
      results = [];
      if (code === "browser") state(t("on_browser"));
      else if (code === "notfound") state(t("on_notfound"));
      else state(t("on_error"));
    }
  }

  /* ------------------------------ init ------------------------------- */
  function init() {
    const inp = $("#ytSearch"), go = $("#ytGo"), items = host();
    if (go) go.addEventListener("click", () => run(inp ? inp.value : ""));
    if (inp) inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); run(inp.value); }
    });

    // pulsación larga sobre una fila → activa selección múltiple
    let lpTimer = 0, lpVid = "", lpFired = false, lpX = 0, lpY = 0;
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } };
    if (items) {
      items.addEventListener("pointerdown", (e) => {
        const row = e.target.closest(".yt-row"); if (!row) return;
        lpFired = false; lpVid = row.getAttribute("data-vid"); lpX = e.clientX; lpY = e.clientY;
        clearLp();
        lpTimer = setTimeout(() => {
          lpFired = true;
          if (!sel.on) enterSelect(lpVid); else toggleSel(lpVid);
          try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
        }, 450);
      });
      items.addEventListener("pointermove", (e) => {
        if (lpTimer && (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10)) clearLp();
      });
      items.addEventListener("pointerup", clearLp);
      items.addEventListener("pointercancel", clearLp);
      items.addEventListener("pointerleave", clearLp);

      items.addEventListener("click", (e) => {
        const ext = e.target.closest("[data-ext]");
        if (ext) { e.preventDefault(); e.stopPropagation(); openExt(ext.getAttribute("data-ext")); return; }
        if (lpFired) { lpFired = false; e.preventDefault(); e.stopPropagation(); return; }
        if (sel.on) {
          const row = e.target.closest(".yt-row");
          if (row) toggleSel(row.getAttribute("data-vid"));
          return;
        }
        const dl = e.target.closest("[data-dl]");
        if (dl) { e.stopPropagation(); enqueueDownload(parseInt(dl.getAttribute("data-dl"), 10)); return; }
        const add = e.target.closest("[data-add]");
        if (add) { e.stopPropagation(); addToList(parseInt(add.getAttribute("data-add"), 10)); return; }
        const row = e.target.closest(".yt-row");
        if (row) play(parseInt(row.getAttribute("data-i"), 10));
      });
    }

    // barra inferior fija
    const bind = (id, fn) => { const b = $("#" + id); if (b) b.addEventListener("click", fn); };
    bind("ytSelectToggle", () => { if (sel.on) exitSelect(); else enterSelect(""); });
    bind("ytAddAll", addAll);
    bind("ytDlAll", batchDownload);
    bind("ytSelPlay", playSelected);
    bind("ytSelAdd", addSelectedToList);
    bind("ytSelDl", downloadSelected);
    bind("ytSelCancel", exitSelect);

    installDlCallbacks();
    setEmpty();
  }

  // API pública: rellena el buscador con una URL/consulta y la ejecuta.
  // La usa el bridge nativo cuando se comparte un enlace de YouTube a la app.
  window.DSKYoutubeUI = {
    openQuery: function (q) {
      const inp = $("#ytSearch");
      if (inp) inp.value = q || "";
      run(q || "");
    },
    exitSelect: function () { if (sel.on) exitSelect(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();