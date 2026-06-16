/* =============================================================================
   DSK•LoFi — lyrics.js
   Búsqueda de letras en un modal, SIN servidor intermedio ni proxy.

   FUENTES
     - LRCLIB  → API libre (letra plana + SINCRONIZADA .lrc).
     - Genius  → scraping del HTML (solo letra plana).

   TRANSPORTE
     - App Android: window.DSKLyrics (LyricsBridge.kt) para AMBAS fuentes.
     - Navegador/PWA: LRCLIB por fetch directo (CORS abierto).

   NUEVO (rediseño):
     - Barra inferior compacta de iconos: play/pausa · quitar voz · modo
       karaoke · compartir · PDF (sin texto).
     - Modo Karaoke a pantalla completa (#karaokeModal) con resaltado de la
       frase/palabra en reproducción. Cierra con la X o con el botón Atrás.

   API pública:  window.Lyrics.open(title, artist) · .close() · .back() · .isOpen()
   ========================================================================== */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const t = (k) => (window.I18n ? I18n.t(k) : k);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const ICON_PLAY  = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 4.5 20 12 8 19.5"></polygon></svg>';
  const ICON_PAUSE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14"></rect><rect x="14" y="5" width="4" height="14"></rect></svg>';
  let ctlTimer = 0;

  const native = () =>
    typeof window.DSKLyrics !== "undefined" &&
    typeof window.DSKLyrics.search === "function";

  function cleanQuery(q) {
    const c = String(q || "")
      .replace(/\.(mp3|wav|ogg|opus|flac|m4a|aac|webm)$/i, "")
      .replace(/[\[(\{][^\])\}]*[\])\}]/g, " ")
      .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, " ")
      .replace(/[\/\\|·–—_*"'`~^<>:;]+/g, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return c || String(q || "").trim();
  }

  /* ----------------------------- estado ----------------------------- */
  let source = "lrclib";
  let results = [];
  let curQuery = "";
  let curResult = null;
  let curMode = "plain";
  let pendingSelection = "";
  let syncRAF = 0;
  let loadedKey = "";   // clave (canción) de la búsqueda actualmente cargada

  // clave de canción para decidir si reabrir reusa lo ya cargado o re-busca
  function keyOf(q) { return String(q || "").trim().toLowerCase(); }

  try {
    const s = localStorage.getItem("dsklofi.lyrsrc");
    if (s === "genius" || s === "lrclib") source = s;
  } catch (e) {}

  /* --------------------- puente nativo (callbacks) -------------------- */
  const pending = {};
  let reqSeq = 0;
  let callbacksReady = false;

  function installNativeCallbacks() {
    if (callbacksReady || !native()) return;
    window.DSKLyrics.__result = function (reqId, json) {
      const p = pending[reqId]; if (!p) return; delete pending[reqId];
      let arr = []; try { arr = JSON.parse(json) || []; } catch (e) { arr = []; }
      p.resolve(arr);
    };
    window.DSKLyrics.__error = function (reqId, code) {
      const p = pending[reqId]; if (!p) return; delete pending[reqId];
      p.reject(code || "network");
    };
    callbacksReady = true;
  }

  function searchNative(query, src) {
    return new Promise((resolve, reject) => {
      const reqId = "lyr" + (++reqSeq) + "_" + Date.now();
      const to = setTimeout(() => {
        if (pending[reqId]) { delete pending[reqId]; reject("network"); }
      }, 20000);
      pending[reqId] = {
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject:  (e) => { clearTimeout(to); reject(e); }
      };
      try { window.DSKLyrics.search(query, src, reqId); }
      catch (e) { clearTimeout(to); delete pending[reqId]; reject("network"); }
    });
  }

  async function searchBrowser(query, src) {
    if (src !== "lrclib") throw "remote_browser";
    const r = await fetch(
      "https://lrclib.net/api/search?q=" + encodeURIComponent(query),
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) throw "network";
    const arr = await r.json();
    return (arr || [])
      .filter((o) => o && (o.plainLyrics || o.syncedLyrics))
      .slice(0, 15)
      .map((o) => ({
        source: "lrclib",
        title: o.trackName || "",
        artist: o.artistName || "",
        plain: o.plainLyrics || "",
        synced: o.syncedLyrics || "",
        url: ""
      }));
  }

  function doSearch(query, src) {
    installNativeCallbacks();
    return native() ? searchNative(query, src) : searchBrowser(query, src);
  }

  /* ----------------------------- .lrc -------------------------------- */
  // Devuelve [{t, text, words?:[{t,text}]}]. Soporta LRC mejorado (A2): tags de
  // palabra <mm:ss.xx> dentro de la línea para resaltado palabra a palabra.
  function parseLrc(text) {
    const out = [];
    String(text || "").split(/\r?\n/).forEach((line) => {
      const tags = line.match(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g);
      if (!tags) return;
      let body = line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "");
      // palabras con tiempo: <mm:ss.xx>palabra
      let words = null;
      if (/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/.test(body)) {
        words = [];
        const re = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g;
        let mw;
        while ((mw = re.exec(body)) !== null) {
          const sec = (+mw[1]) * 60 + (+mw[2]) + (mw[3] ? +("0." + mw[3]) : 0);
          const txt = mw[4];
          if (txt !== "") words.push({ t: sec, text: txt });
        }
        body = body.replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, "");
      }
      body = body.trim();
      tags.forEach((tag) => {
        const m = tag.match(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/);
        if (!m) return;
        const sec = (+m[1]) * 60 + (+m[2]) + (m[3] ? +("0." + m[3]) : 0);
        out.push({ t: sec, text: body, words: words });
      });
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  function stripLrc(s) { return parseLrc(s).map((l) => l.text).join("\n").trim(); }
  function plainFromResult(r) {
    if (!r) return "";
    return (r.plain && r.plain.trim()) ? r.plain : (r.synced ? stripLrc(r.synced) : "");
  }

  /* --------------------------- pintado UI ----------------------------- */
  function body() { return $("#lyrBody"); }
  function setBody(html) { const b = body(); if (b) b.innerHTML = html; }
  function showActions(on) {
    const a = $("#lyrActions");
    if (!a) return;
    if (on) a.removeAttribute("hidden"); else a.setAttribute("hidden", "hidden");
  }
  function resetView() { curResult = null; showActions(false); stopSync(); stopCtlTimer(); }

  function showLoading() {
    resetView();
    setBody('<div class="lyr-state"><span class="spinner"></span><span>' +
      esc(t("lyr_searching")) + "</span></div>");
  }
  function showNotFound() {
    resetView();
    setBody('<div class="lyr-state lyr-state--empty">' + esc(t("lyr_notfound")) + "</div>");
  }
  function showError(code) {
    resetView();
    const msg = code === "network" ? t("lyr_error_net") : t("lyr_remote_browser");
    setBody('<div class="lyr-state lyr-state--empty">' + esc(msg) + "</div>");
  }

  function renderResults() {
    resetView();
    let h = '<div class="lyr-reshead">' + esc(t("lyr_results")) + "</div>";
    h += '<div class="menu-list lyr-reslist">';
    results.forEach((r, i) => {
      const label = (r.artist ? r.artist + " — " : "") + (r.title || "?");
      const tag = r.source === "genius" ? "Genius" : "LRCLIB";
      const sync = r.synced ? '<span class="lyr-badge lyr-badge--sync">LRC</span>' : "";
      h += '<button class="menu-item lyr-resitem" type="button" data-i="' + i + '">' +
           '<span class="lyr-resitem__txt">' + esc(label) + "</span>" +
           sync + '<span class="lyr-badge">' + tag + "</span></button>";
    });
    h += "</div>";
    setBody(h);
  }

  function songHead(r) {
    const title = (r.title || "").trim();
    const artist = (r.artist || "").trim();
    if (!artist || artist.toLowerCase() === title.toLowerCase()) return title || artist;
    return artist + " — " + title;
  }

  function openLyric(i) {
    const r = results[i];
    if (!r) return;
    curResult = r;
    showActions(true);
    const hasSynced = !!r.synced;
    const hasPlain = !!(r.plain && r.plain.trim());
    curMode = (hasSynced && !hasPlain) ? "synced" : "plain";
    paintLyric();
  }

  // Repinta la letra actual. La barra de control vive FUERA del cuerpo
  // (#lyrActions), así que aquí solo dibujamos el cambio de modo + el texto.
  function paintLyric() {
    const r = curResult;
    if (!r) return;
    stopSync();
    const hasSynced = !!r.synced;
    const hasPlain = !!(r.plain && r.plain.trim());
    if (curMode === "synced" && !hasSynced) curMode = "plain";
    if (curMode === "plain" && !hasPlain && hasSynced) curMode = "synced";

    let h = "";
    if (results.length > 1) {
      h += '<button class="lyr-back" type="button" data-back="1">‹ ' + esc(t("lyr_back")) + "</button>";
    }
    h += '<div class="lyr-songhead">' + esc(songHead(r)) + "</div>";

    // fila de control: solo el selector de modo (si hay ambos). Los botones de
    // play / micrófono se eliminaron: ahora están en la barra inferior.
    if (hasSynced && hasPlain) {
      h += '<div class="lyr-ctl">' +
           '<div class="seg lyr-modeseg" id="lyrModeSeg">' +
           '<button class="seg__item' + (curMode === "plain" ? " seg__item--active" : "") +
           '" type="button" data-mode="plain">' + esc(t("lyr_plain")) + "</button>" +
           '<button class="seg__item' + (curMode === "synced" ? " seg__item--active" : "") +
           '" type="button" data-mode="synced">' + esc(t("lyr_synced")) + "</button></div></div>";
    }

    if (curMode === "synced" && hasSynced) {
      const lines = parseLrc(r.synced);
      h += '<div class="lyr-text lyr-text--synced" id="lyrSynced">';
      lines.forEach((ln, k) => {
        h += '<p class="lyr-line" data-k="' + k + '">' + (ln.text ? esc(ln.text) : "&nbsp;") + "</p>";
      });
      h += "</div>";
      setBody(h);
      startSync(lines);
    } else {
      h += '<div class="lyr-text">' + esc(plainFromResult(r)) + "</div>";
      setBody(h);
    }
    refreshCtl();
    startCtlTimer();
  }

  // ¿la letra actual tiene versión sincronizada (para habilitar Modo Karaoke)?
  function hasSyncedNow() { return !!(curResult && curResult.synced); }

  // refresca iconos/estado de la barra inferior (play, quitar voz, karaoke)
  function refreshCtl() {
    const playing = !!(window.Engine && Engine.playing);
    const playBtn = $("#lyrPlay");
    if (playBtn) {
      playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      playBtn.classList.toggle("is-on", playing);
    }
    const voxBtn = $("#lyrVox");
    if (voxBtn) voxBtn.classList.toggle("is-on", !!(window.Engine && Engine.karaokeOn));
    const kBtn = $("#lyrKaraoke");
    if (kBtn) {
      const can = hasSyncedNow();
      kBtn.disabled = !can;
      kBtn.classList.toggle("is-disabled", !can);
      kBtn.classList.toggle("is-on", karaokeOpen());
    }
    // refrescar también la barra del karaoke a pantalla completa, si está abierto
    if (karaokeOpen()) {
      const kp = $("#kPlay");
      if (kp) { kp.innerHTML = playing ? ICON_PAUSE : ICON_PLAY; kp.classList.toggle("is-on", playing); }
      const kv = $("#kVox");
      if (kv) kv.classList.toggle("is-on", !!(window.Engine && Engine.karaokeOn));
    }
  }
  function startCtlTimer() { stopCtlTimer(); ctlTimer = setInterval(refreshCtl, 600); }
  function stopCtlTimer() { if (ctlTimer) { clearInterval(ctlTimer); ctlTimer = 0; } }

  /* ----------------- resaltado en vivo de la letra (modal normal) ------- */
  function startSync(lines) {
    stopSync();
    const cont = $("#lyrSynced");
    if (!cont || !lines.length) return;
    let last = -1;
    function tick() {
      syncRAF = requestAnimationFrame(tick);
      if (!window.Engine || !Engine.playing) return;
      const pos = (typeof Engine.position === "function") ? Engine.position() : 0;
      let idx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= pos + 0.15) idx = i; else break;
      }
      if (idx === last) return;
      last = idx;
      const ps = cont.querySelectorAll(".lyr-line");
      ps.forEach((p, k) => p.classList.toggle("is-cur", k === idx));
      if (idx >= 0 && ps[idx]) ps[idx].scrollIntoView({ block: "center", behavior: "smooth" });
    }
    tick();
  }
  function stopSync() { if (syncRAF) { cancelAnimationFrame(syncRAF); syncRAF = 0; } }

  /* =======================================================================
     MODO KARAOKE — pantalla completa
     ===================================================================== */
  let kRAF = 0;
  let kLines = [];
  let kLast = -2;

  function karaokeOpen() {
    const m = $("#karaokeModal");
    return !!(m && m.classList.contains("modal--open"));
  }

  function openKaraoke() {
    if (!hasSyncedNow()) { if (window.UI) UI.toast(t("kar_need_sync")); return; }
    kLines = parseLrc(curResult.synced);
    if (!kLines.length) { if (window.UI) UI.toast(t("kar_need_sync")); return; }
    const head = $("#kHead");
    if (head) head.textContent = songHead(curResult);
    const stage = $("#kStage");
    if (stage) {
      let h = "";
      kLines.forEach((ln, k) => {
        h += '<div class="kar-line" data-k="' + k + '">' + renderKarLine(ln) + "</div>";
      });
      stage.innerHTML = h;
    }
    kLast = -2;
    if (window.UI) UI.openModal("karaokeModal");
    refreshCtl();
    startKaraokeLoop();
  }

  // Una línea del karaoke: si tiene palabras con tiempo, las envuelve en <span>
  // para resaltarlas una a una; si no, una sola frase (se resaltará entera y con
  // un barrido proporcional al tiempo).
  function renderKarLine(ln) {
    if (!ln.text) return "&nbsp;";
    if (ln.words && ln.words.length) {
      return ln.words.map((w, i) =>
        '<span class="kar-w" data-wt="' + w.t + '">' + esc(w.text) + "</span>").join("");
    }
    return '<span class="kar-fulltext">' + esc(ln.text) + "</span>";
  }

  function closeKaraoke() {
    stopKaraokeLoop();
    if (window.UI) UI.closeModal("karaokeModal");
    refreshCtl();
  }

  function startKaraokeLoop() {
    stopKaraokeLoop();
    const stage = $("#kStage");
    if (!stage || !kLines.length) return;
    const lineEls = $$(".kar-line", stage);

    function tick() {
      kRAF = requestAnimationFrame(tick);
      const pos = (window.Engine && typeof Engine.position === "function") ? Engine.position() : 0;

      // línea actual
      let idx = -1;
      for (let i = 0; i < kLines.length; i++) {
        if (kLines[i].t <= pos + 0.12) idx = i; else break;
      }

      if (idx !== kLast) {
        kLast = idx;
        lineEls.forEach((el, k) => {
          el.classList.toggle("is-cur", k === idx);
          el.classList.toggle("is-past", k < idx);
        });
        const cur = lineEls[idx];
        if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      // resaltado dentro de la línea actual
      const cur = lineEls[idx];
      if (cur) {
        const ln = kLines[idx];
        const next = kLines[idx + 1];
        if (ln && ln.words && ln.words.length) {
          // palabra a palabra
          const ws = cur.querySelectorAll(".kar-w");
          let wOn = -1;
          for (let j = 0; j < ln.words.length; j++) {
            if (ln.words[j].t <= pos + 0.05) wOn = j; else break;
          }
          ws.forEach((wel, j) => {
            wel.classList.toggle("is-sung", j <= wOn);
            wel.classList.toggle("is-cur", j === wOn);
          });
        } else {
          // barrido proporcional de la frase entera
          const ft = cur.querySelector(".kar-fulltext");
          if (ft) {
            const start = ln.t;
            const end = next ? next.t : start + 4;
            const frac = Math.max(0, Math.min(1, (pos - start) / Math.max(0.1, end - start)));
            ft.style.setProperty("--kfill", (frac * 100) + "%");
          }
        }
      }
    }
    tick();
  }
  function stopKaraokeLoop() { if (kRAF) { cancelAnimationFrame(kRAF); kRAF = 0; } }

  /* ------------------------------ flujo ------------------------------ */
  async function run(query) {
    query = (query || "").trim();
    if (!query) return;
    curQuery = query;
    loadedKey = keyOf(query);
    stopSync();
    showLoading();
    try {
      results = await doSearch(cleanQuery(query), source);
      if (!results.length) { showNotFound(); return; }
      if (results.length === 1) openLyric(0);
      else renderResults();
    } catch (code) {
      if (code === "notfound") showNotFound();
      else showError(code);
    }
  }

  /* --------------------- compartir / guardar PDF --------------------- */
  function selectedLyricText() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
      const b = body();
      if (b && (b.contains(sel.anchorNode) || b.contains(sel.focusNode))) return sel.toString().trim();
    } catch (e) {}
    return "";
  }

  function sendShare(text, head) {
    try { if (window.DSKBridge && DSKBridge.shareText) { DSKBridge.shareText(text); return; } } catch (e) {}
    if (navigator.share) { navigator.share({ title: head || "DSK•LoFi", text: text }).catch(() => {}); return; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        if (window.UI) UI.toast(t("copied"));
      }
    } catch (e) {}
  }

  async function share() {
    if (!curResult) return;
    const r = curResult;
    const title = (r.title || "").trim();
    const artist = (r.artist || "").trim();
    const head = songHead(r);
    const foot = "— " + t("lyr_shared_from") + " DSK•LoFi\nhttps://apps.dskmusic.com";
    const sel = pendingSelection || selectedLyricText();
    pendingSelection = "";
    let useSel = false;
    if (sel && window.UI && UI.confirm) {
      useSel = await UI.confirm({
        title: t("lyr_share"), message: t("lyr_share_ask"),
        confirmLabel: t("lyr_share_sel"), cancelLabel: t("lyr_share_full")
      });
    }
    let text;
    if (useSel) {
      const songLine = (artist ? artist + " — " : "") + title;
      text = '"' + sel + '"\n\n' + songLine + "\n\n" + foot;
    } else {
      text = head + "\n\n" + plainFromResult(r) + "\n\n" + foot;
    }
    sendShare(text, head);
  }

  function savePdf() {
    if (!curResult) return;
    const r = curResult;
    const title = (r.title || "").trim() || "—";
    const artist = (r.artist || "").trim();
    const lyrics = plainFromResult(r);
    try {
      if (window.DSKBridge && DSKBridge.saveLyricsPdf) { DSKBridge.saveLyricsPdf(artist, title, lyrics); return; }
    } catch (e) {}
    printFallback(artist, title, lyrics);
  }

  function printFallback(artist, title, lyrics) {
    try {
      const w = window.open("", "_blank");
      if (!w) { if (window.UI) UI.toast(t("lyr_pdf_app_only")); return; }
      w.document.write(
        '<html><head><meta charset="utf-8"><title>' + esc(title) + "</title><style>" +
        "body{font-family:system-ui,sans-serif;margin:40px;color:#111}" +
        "h1{font-size:26px;margin:0 0 4px}h2{font-size:15px;color:#666;font-weight:400;margin:0 0 24px}" +
        "pre{white-space:pre-wrap;font:inherit;font-size:14px;line-height:1.6}" +
        "footer{margin-top:32px;color:#888;font-size:12px;border-top:1px solid #ddd;padding-top:10px}" +
        "</style></head><body><h1>" + esc(title) + "</h1><h2>" + esc(artist) +
        "</h2><pre>" + esc(lyrics) + "</pre><footer>DSK•LoFi — apps.dskmusic.com</footer></body></html>"
      );
      w.document.close(); w.focus();
      setTimeout(() => { try { w.print(); } catch (e) {} }, 300);
    } catch (e) {}
  }

  /* ---------------------------- público ------------------------------ */
  function isOpen() {
    const m = $("#lyricsModal");
    return !!(m && m.classList.contains("modal--open"));
  }
  function open(title, artist) {
    installNativeCallbacks();
    const inp = $("#lyrSearch");
    const q = ((artist ? artist + " " : "") + (title || "")).trim();
    // Misma canción y ya hay algo cargado → restaurar SIN volver a buscar:
    // si había una letra elegida, se muestra esa; si no, la lista de resultados.
    if (q && keyOf(q) === loadedKey && (curResult || results.length)) {
      if (inp) inp.value = q;
      if (window.UI) UI.openModal("lyricsModal");
      if (curResult) { showActions(true); paintLyric(); }
      else renderResults();
      return;
    }
    if (inp) inp.value = q;
    if (window.UI) UI.openModal("lyricsModal");
    if (q) run(q);
    else { resetView(); setBody('<div class="lyr-state lyr-state--empty">' + esc(t("lyr_empty")) + "</div>"); }
  }
  function close() {
    stopSync(); stopKaraokeLoop(); stopCtlTimer();
    showActions(false);
    if (window.UI) { UI.closeModal("karaokeModal"); UI.closeModal("lyricsModal"); }
  }
  // Back del dispositivo. Nota: el karaoke a pantalla completa es un modal con
  // mayor z-index, así que DSKHandleBack lo cierra primero por sí mismo. Aquí
  // cubrimos el caso del modal de letras: volver a la lista o cerrar.
  function back() {
    if (karaokeOpen()) { closeKaraoke(); return; }
    if (curResult && results.length > 1) { stopSync(); stopCtlTimer(); renderResults(); return; }
    close();
  }

  /* ------------------------------ init ------------------------------- */
  function init() {
    const inp = $("#lyrSearch");
    const go = $("#lyrGo");
    const srcHost = $("#lyrSrc");

    if (go) go.addEventListener("click", () => run(inp ? inp.value : ""));
    if (inp) inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); run(inp.value); }
    });

    // barra inferior de iconos: play · quitar voz · modo karaoke · compartir · PDF
    const playBtn = $("#lyrPlay");
    if (playBtn) playBtn.addEventListener("click", () => {
      try { if (window.DSKControls) DSKControls.toggle(); } catch (e) {}
      setTimeout(refreshCtl, 80);
    });
    const voxBtn = $("#lyrVox");
    if (voxBtn) voxBtn.addEventListener("click", () => {
      try { if (window.Engine && Engine.setKaraoke) Engine.setKaraoke(!Engine.karaokeOn); } catch (e) {}
      refreshCtl();
    });
    const kBtn = $("#lyrKaraoke");
    if (kBtn) kBtn.addEventListener("click", () => { if (!kBtn.disabled) openKaraoke(); });

    const sh = $("#lyrShare"), pf = $("#lyrPdf");
    if (sh) {
      sh.addEventListener("pointerdown", () => { pendingSelection = selectedLyricText(); });
      sh.addEventListener("click", share);
    }
    if (pf) pf.addEventListener("click", savePdf);

    // controles del karaoke a pantalla completa
    const kPlay = $("#kPlay");
    if (kPlay) kPlay.addEventListener("click", () => {
      try { if (window.DSKControls) DSKControls.toggle(); } catch (e) {}
      setTimeout(refreshCtl, 80);
    });
    const kVox = $("#kVox");
    if (kVox) kVox.addEventListener("click", () => {
      try { if (window.Engine && Engine.setKaraoke) Engine.setKaraoke(!Engine.karaokeOn); } catch (e) {}
      refreshCtl();
    });
    const kClose = $("#kClose");
    if (kClose) kClose.addEventListener("click", closeKaraoke);

    // selector de fuente (LRCLIB / Genius / NetEase)
    if (srcHost && window.UI) {
      const segApi = UI.segmented(srcHost, (val) => {
        source = (val === "genius" || val === "netease") ? val : "lrclib";
        try { localStorage.setItem("dsklofi.lyrsrc", source); } catch (e) {}
        if (curQuery) run(curQuery);
      });
      segApi.set(source);
    }

    // clics dentro del cuerpo: elegir resultado / volver / cambiar de modo
    const b = body();
    if (b) b.addEventListener("click", (e) => {
      const item = e.target.closest(".lyr-resitem");
      if (item) { openLyric(parseInt(item.getAttribute("data-i"), 10)); return; }
      const bk = e.target.closest("[data-back]");
      if (bk) { stopSync(); renderResults(); return; }
      const md = e.target.closest("[data-mode]");
      if (md) { curMode = md.getAttribute("data-mode"); paintLyric(); return; }
    });

    // cerrar (X / velo) detiene resaltados
    const modal = $("#lyricsModal");
    if (modal) modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]") ||
          (e.target.classList && e.target.classList.contains("modal__scrim"))) {
        stopSync(); showActions(false);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.Lyrics = { open, close, back, isOpen };
})();
