/* =============================================================================
   DSK•LoFi — app.js
   Wires engine + UI: file loading, transport, FX sections, presets, export,
   options (theme/language/restore), visualizers, PWA registration.
   ========================================================================== */
(function () {
  "use strict";
  const { $, $$ } = UI;
  const VERSION = "1.0.0";   // fallback (navegador/PWA, sin bridge nativo)
  function getAppVersion() {
    try {
      if (typeof window.DSKBridge !== "undefined" && typeof window.DSKBridge.appVersion === "function") {
        const v = window.DSKBridge.appVersion();
        if (v) return v;
      }
    } catch (e) {}
    return VERSION;
  }
  const LS = { theme: "dsklofi.theme", params: "dsklofi.params", collapsed: "dsklofi.collapsed" };

  /* ========================= THEME ========================= */
  // 4 oscuros (izquierda) + 4 claros (derecha). swatch = color de muestra.
  const THEMES = [
    { id: "dark",         dark: true,  swatch: "#00FF41", meta: "#1E1E1E" },
    { id: "dark-cyan",    dark: true,  swatch: "#4ECDC4", meta: "#14191A" },
    { id: "dark-amber",   dark: true,  swatch: "#FFB23E", meta: "#1B1812" },
    { id: "dark-magenta", dark: true,  swatch: "#FF4D9D", meta: "#1A1620" },
    { id: "light",        dark: false, swatch: "#00871F", meta: "#E8EBE8" },
    { id: "light-blue",   dark: false, swatch: "#1466C7", meta: "#E6ECF4" },
    { id: "light-rose",   dark: false, swatch: "#C2185B", meta: "#F4E9EE" },
    { id: "light-violet", dark: false, swatch: "#6D4AC2", meta: "#ECE8F4" }
  ];
  const THEME_BY_ID = {};
  THEMES.forEach((t) => { THEME_BY_ID[t.id] = t; });

  function setTheme(t, persist) {
    const def = THEME_BY_ID[t] ? t : "dark";
    document.documentElement.setAttribute("data-theme", def);
    if (persist !== false) localStorage.setItem(LS.theme, def);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_BY_ID[def].meta);
  }

  /* ========================= FORMATTERS ========================= */
  const fmt = {
    pct: (v) => Math.round(v * 100) + "%",
    hz: (v) => {
      const f = 700 * Math.pow(20000 / 700, v);
      return f >= 1000 ? (f / 1000).toFixed(1) + " kHz" : Math.round(f) + " Hz";
    },
    bits: (v) => Math.round(16 - v * 12) + " bit",
    secs: (v) => (0.5 + v * 4.5).toFixed(1) + " s",
    ms: (v) => Math.round((0.06 + v * 0.84) * 1000) + " ms",
    lfoHz: (v) => (0.15 + v * 4.0).toFixed(2) + " Hz",
    db: (v) => { const d = (v || 0) * 6; return (d > 0 ? "+" : "") + d.toFixed(1) + " dB"; },
    time: (s) => {
      s = Math.max(0, s || 0);
      const m = Math.floor(s / 60), ss = Math.floor(s % 60);
      return String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    }
  };

  /* ========================= SECTION CONFIG ========================= */
  const SECTIONS = {
    lofi: {
      params: [
        { key: "tone", labelKey: "p_tone", format: fmt.hz },
        { key: "crush", labelKey: "p_crush", format: fmt.bits },
        { key: "hiss", labelKey: "p_hiss", format: fmt.pct },
        { key: "crackle", labelKey: "p_crackle", format: fmt.pct },
        { key: "wow", labelKey: "p_wow", format: fmt.pct }
      ],
      presets: [
        { id: "vinyl", labelKey: "pr_lofi_vinyl", values: { tone: 0.45, crush: 0.35, hiss: 0.15, crackle: 0.65, wow: 0.25 } },
        { id: "tape",  labelKey: "pr_lofi_tape",  values: { tone: 0.55, crush: 0.20, hiss: 0.50, crackle: 0.08, wow: 0.45 } },
        { id: "radio", labelKey: "pr_lofi_radio", values: { tone: 0.28, crush: 0.55, hiss: 0.30, crackle: 0.12, wow: 0.12 } },
        { id: "dream", labelKey: "pr_lofi_dream", values: { tone: 0.40, crush: 0.25, hiss: 0.25, crackle: 0.20, wow: 0.60 } },
        { id: "clean", labelKey: "pr_lofi_clean", values: { tone: 0.70, crush: 0.12, hiss: 0.10, crackle: 0.12, wow: 0.12 } }
      ]
    },
    reverb: {
      params: [
        { key: "mix", labelKey: "p_rv_mix", format: fmt.pct },
        { key: "size", labelKey: "p_rv_size", format: fmt.secs },
        { key: "damp", labelKey: "p_rv_damp", format: fmt.pct }
      ],
      presets: [
        { id: "room", labelKey: "pr_rv_room", values: { mix: 0.18, size: 0.25, damp: 0.60 } },
        { id: "hall", labelKey: "pr_rv_hall", values: { mix: 0.30, size: 0.55, damp: 0.45 } },
        { id: "cave", labelKey: "pr_rv_cave", values: { mix: 0.45, size: 0.85, damp: 0.30 } }
      ]
    },
    delay: {
      params: [
        { key: "time", labelKey: "p_dl_time", format: fmt.ms },
        { key: "fb", labelKey: "p_dl_fb", format: fmt.pct },
        { key: "mix", labelKey: "p_dl_mix", format: fmt.pct }
      ],
      presets: [
        { id: "slap", labelKey: "pr_dl_slap", values: { time: 0.12, fb: 0.15, mix: 0.30 } },
        { id: "echo", labelKey: "pr_dl_echo", values: { time: 0.35, fb: 0.40, mix: 0.30 } },
        { id: "dub",  labelKey: "pr_dl_dub",  values: { time: 0.50, fb: 0.62, mix: 0.40 } }
      ]
    },
    chorus: {
      params: [
        { key: "rate", labelKey: "p_ch_rate", format: fmt.lfoHz },
        { key: "depth", labelKey: "p_ch_depth", format: fmt.pct },
        { key: "mix", labelKey: "p_ch_mix", format: fmt.pct }
      ],
      presets: [
        { id: "soft",   labelKey: "pr_ch_soft",   values: { rate: 0.20, depth: 0.30, mix: 0.30 } },
        { id: "wide",   labelKey: "pr_ch_wide",   values: { rate: 0.30, depth: 0.55, mix: 0.55 } },
        { id: "wobble", labelKey: "pr_ch_wobble", values: { rate: 0.60, depth: 0.75, mix: 0.50 } }
      ]
    },
    space: {
      params: [
        { key: "width",  labelKey: "p_sp_width",  format: fmt.pct },
        { key: "amount", labelKey: "p_sp_amount", format: fmt.pct }
      ],
      presets: [
        { id: "subtle", labelKey: "pr_sp_subtle", values: { width: 0.35, amount: 0.35 } },
        { id: "wide",   labelKey: "pr_sp_wide",   values: { width: 0.60, amount: 0.55 } },
        { id: "huge",   labelKey: "pr_sp_huge",   values: { width: 0.90, amount: 0.80 } }
      ]
    }
  };

  const sliders = {};   // sliders[section][key] -> slider api
  const presetRows = {}; // presetRows[section] -> row api
  let volumeSlider = null;
  let tapeEffect = true;  // switch "tape start/stop" — activo por defecto

  /* ========================= PERSISTENCE ========================= */
  let saveTimer = null;
  function persistParams() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS.params, JSON.stringify(Engine.params)); } catch (e) {}
    }, 250);
  }

  function restoreParams() {
    try {
      const raw = localStorage.getItem(LS.params);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const def = Engine.DEFAULTS;
      for (const sec of Object.keys(def)) {
        if (saved[sec]) Object.assign(Engine.params[sec], saved[sec]);
      }
    } catch (e) {}
  }

  /* ========================= BUILD FX SECTIONS ========================= */
  function buildSections() {
    Object.keys(SECTIONS).forEach((sec) => {
      const cfg = SECTIONS[sec];
      const host = $('[data-sec="' + sec + '"]');
      sliders[sec] = {};

      /* presets */
      presetRows[sec] = UI.presetRow({
        host: $(".fx__presets", host),
        presets: cfg.presets,
        onApply: (p) => {
          Engine.setSection(sec, Object.assign({ on: true }, p.values));
          setSwitch(sec, true);
          syncSection(sec);
          persistParams();
        }
      });

      /* sliders */
      const body = $(".fx__params", host);
      cfg.params.forEach((pc) => {
        const s = UI.slider({
          key: pc.key,
          labelKey: pc.labelKey,
          value: Engine.params[sec][pc.key],
          format: pc.format,
          onInput: (v) => {
            Engine.setParam(sec, pc.key, v);
            presetRows[sec].clear();
            persistParams();
          },
          onReset: () => {
            const dv = Engine.DEFAULTS[sec][pc.key];
            Engine.setParam(sec, pc.key, dv);
            s.set(dv);
            persistParams();
          }
        });
        sliders[sec][pc.key] = s;
        body.appendChild(s.el);
      });

      /* on/off switch */
      const sw = $(".switch", host);
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = !Engine.params[sec].on;
        Engine.setParam(sec, "on", on);
        setSwitch(sec, on);
        persistParams();
      });

      /* section reset */
      $(".fx__reset", host).addEventListener("click", async (e) => {
        e.stopPropagation();
        Engine.resetSection(sec);
        syncSection(sec);
        presetRows[sec].clear();
        persistParams();
        UI.toast(I18n.t("section_reset") + " · " + I18n.t("sec_" + sec));
      });
    });

    /* output volume */
    volumeSlider = UI.slider({
      key: "volume", labelKey: "p_volume",
      value: Engine.params.output.volume, format: fmt.pct,
      onInput: (v) => { Engine.setParam("output", "volume", v); persistParams(); }
    });
    $("#outputParams").appendChild(volumeSlider.el);
  }

  function setSwitch(sec, on) {
    const host = $('[data-sec="' + sec + '"]');
    host.classList.toggle("fx--off", !on);
    const sw = $(".switch", host);
    sw.classList.toggle("switch--on", on);
    sw.setAttribute("aria-checked", on ? "true" : "false");
    $(".switch__txt", sw).textContent = I18n.t(on ? "fx_on" : "fx_off");
  }

  function syncSection(sec) {
    const cfg = SECTIONS[sec];
    cfg.params.forEach((pc) => sliders[sec][pc.key].set(Engine.params[sec][pc.key]));
    setSwitch(sec, Engine.params[sec].on);
  }

  function syncAll() {
    Object.keys(SECTIONS).forEach(syncSection);
    if (volumeSlider) volumeSlider.set(Engine.params.output.volume);
  }

  /* ========================= FILE LOADING ========================= */
  /* ========================= PLAYLIST ========================= */
  const fileInput = $("#fileInput");
  const dirInput = $("#dirInput");
  const nativeAudio = $("#nativeAudio");
  let playerOnlyMode = false;
  let ytPendingResolve = false;   // cola YT restaurada en frío: stream sin resolver aún
  let nativeUrlObj = null;
  let peaks = null;

  /* ====== keep-alive: vía Web Audio en el Engine (señal inaudible). Evita que
     el WebView se congele en segundo plano SIN secuestrar la sesión multimedia. ====== */
  function keepAliveOn() {
    try { Engine._startKeepAlive && Engine._startKeepAlive(); } catch (e) {}
  }

  /* ====== título: marquee si el nombre no cabe entre las bobinas ====== */
  let curTitle = "", curArtist = "";   // lo que se muestra ahora (para la notificación)
  let curDurationOverride = 0;          // duración conocida (YouTube); 0 = usar Engine.duration()
  function setTrackName(text) {
    curTitle = text || "";
    const vp = $("#trackName");
    if (!vp) return;
    vp.style.overflow = "hidden";
    vp.style.whiteSpace = "nowrap";
    let inner = vp.querySelector(".deck__name-txt");
    if (!inner) { inner = document.createElement("span"); inner.className = "deck__name-txt"; vp.textContent = ""; vp.appendChild(inner); }
    inner.style.display = "inline-block";
    inner.style.whiteSpace = "nowrap";
    inner.textContent = text;
    vp.title = text;   // título completo en tooltip (extra)
    requestAnimationFrame(() => requestAnimationFrame(updateMarquee));
  }
  function updateMarquee() {
    const vp = $("#trackName");
    if (!vp) return;
    const inner = vp.querySelector(".deck__name-txt");
    if (!inner) return;
    vp.classList.remove("is-marquee");          // reiniciar para medir/relanzar
    inner.style.maxWidth = "none";
    const full = inner.scrollWidth;
    inner.style.maxWidth = "";
    const overflow = full - vp.clientWidth;
    if (overflow > 6) {
      const speed = 45, moveFrac = 0.35;         // px/s y fracción de la animación dedicada al recorrido
      const total = Math.max(6, (overflow / speed) / moveFrac);
      vp.style.setProperty("--marquee-shift", (-overflow) + "px");
      vp.style.setProperty("--marquee-dur", total.toFixed(2) + "s");
      vp.classList.add("is-marquee");
      // reinicio explícito (algunos WebView no relanzan la animación al re-añadir la clase)
      inner.style.animation = "none";
      void inner.offsetWidth;
      inner.style.animation = "";
    } else {
      vp.style.removeProperty("--marquee-shift");
      vp.style.removeProperty("--marquee-dur");
    }
  }
  { let mqT; window.addEventListener("resize", () => { clearTimeout(mqT); mqT = setTimeout(updateMarquee, 160); }); }

  /* ====== auto-ganancia: caché de RMS por nombre de archivo ====== */
  const RMS_LS = "dsklofi.rms";
  let rmsCache = {};
  try { rmsCache = JSON.parse(localStorage.getItem(RMS_LS) || "{}") || {}; } catch (e) { rmsCache = {}; }
  function rmsCacheGet(name) { const v = rmsCache[name]; return (typeof v === "number") ? v : null; }
  function rmsCacheSet(name, v) {
    try {
      rmsCache[name] = v;
      const keys = Object.keys(rmsCache);
      if (keys.length > 500) delete rmsCache[keys[0]];   // tope simple
      localStorage.setItem(RMS_LS, JSON.stringify(rmsCache));
    } catch (e) {}
  }
  // aplica la auto-ganancia para la pista LoFi (buffer ya decodificado)
  function applyTrackNormLofi(name, buf) {
    let rms = rmsCacheGet(name);
    if (rms == null && buf) { rms = Engine.measureRMS(buf); rmsCacheSet(name, rms); }
    Engine.applyTrackGain(rms != null ? rms : 1);
  }
  // aplica la auto-ganancia para el modo reproductor (decodifica el blob aparte,
  // diferido: no bloquea la reproducción del <audio> nativo)
  function applyTrackNormNative(name, blob) {
    const cached = rmsCacheGet(name);
    if (cached != null) { Engine.applyTrackGain(cached); return; }
    Engine.applyTrackGain(1);   // neutro hasta poder medir
    if (!blob || !blob.arrayBuffer || !Engine.ctx) return;
    blob.arrayBuffer()
      .then((ab) => Engine.ctx.decodeAudioData(ab.slice(0)))
      .then((dbuf) => { const r = Engine.measureRMS(dbuf); rmsCacheSet(name, r); Engine.applyTrackGain(r); })
      .catch(() => {});
  }

  /* ---- conmutación de modo LoFi <-> solo reproductor ---- */
  let applyPlayerOnlyRef = null;   // asignada en buildOptions
  function syncModeUI() {
    const sw = $("#swPlayerOnly");
    if (sw) sw.setAttribute("aria-checked", playerOnlyMode ? "true" : "false");
    const b = $("#btnMode");
    if (b) b.classList.toggle("is-on", !playerOnlyMode);   // activo = motor LoFi
  }
  async function requestMode(toPlayerOnly) {
    if (!applyPlayerOnlyRef || playerOnlyMode === !!toPlayerOnly) return;
    const wasPlaying = Engine.playing;
    const pos = Engine.position();
    const cur = playlist[plIndex];
    try { Engine.stop(); } catch (e) {}
    applyPlayerOnlyRef(!!toPlayerOnly, true);
    syncModeUI();
    if (cur) { pendingRestorePos = pos > 1 ? pos : 0; await loadFile(cur, wasPlaying); }
  }

  const AUDIO_RE = /\.(mp3|wav|ogg|opus|flac|m4a|aac|webm)$/i;

  /* Lee artista (TPE1/TP1) y título (TIT2/TT2) de un ID3v2. Devuelve {artist,title}. */
  function decodeId3Text(enc, bytes) {
    try {
      if (enc === 1) return new TextDecoder("utf-16").decode(bytes);
      if (enc === 2) return new TextDecoder("utf-16be").decode(bytes);
      if (enc === 3) return new TextDecoder("utf-8").decode(bytes);
      return new TextDecoder("iso-8859-1").decode(bytes);
    } catch (e) {
      let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s;
    }
  }
  function readTextFrame(fb) {
    if (!fb || !fb.length) return "";
    return decodeId3Text(fb[0], fb.subarray(1)).replace(/\u0000+$/, "").trim();
  }
  function parseTrackTags(ab) {
    const out = { artist: "", title: "" };
    try {
      const u8 = new Uint8Array(ab);
      if (!(u8.length > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33)) return out;
      const ver = u8[3], flags = u8[5];
      const tagSize = syncsafe(u8, 6);
      let tag = u8.subarray(10, Math.min(10 + tagSize, u8.length));
      if (flags & 0x80) tag = deunsync(tag);
      let p = 0;
      if ((ver === 3 || ver === 4) && (flags & 0x40)) {
        if (ver === 4) p += syncsafe(tag, 0);
        else p += 4 + (((tag[0] << 24) | (tag[1] << 16) | (tag[2] << 8) | tag[3]) >>> 0);
      }
      const idLen = ver === 2 ? 3 : 4;
      const hdrLen = ver === 2 ? 6 : 10;
      const artId = ver === 2 ? "TP1" : "TPE1";
      const titId = ver === 2 ? "TT2" : "TIT2";
      const tlen = tag.length;
      while (p + hdrLen <= tlen) {
        if (tag[p] === 0) break;
        let id = ""; for (let i = 0; i < idLen; i++) id += String.fromCharCode(tag[p + i]);
        let fsize;
        if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
        else if (ver === 4) fsize = syncsafe(tag, p + 4);
        else fsize = ((tag[p + 4] << 24) | (tag[p + 5] << 16) | (tag[p + 6] << 8) | tag[p + 7]) >>> 0;
        if (fsize <= 0 || p + hdrLen + fsize > tlen) break;
        if (id === artId || id === titId) {
          let off = p + hdrLen, l = fsize, fb;
          if (ver === 4) { const f2 = tag[p + 9]; if (f2 & 0x01) { off += 4; l -= 4; } fb = tag.subarray(off, off + l); if (f2 & 0x02) fb = deunsync(fb); }
          else fb = tag.subarray(off, off + l);
          const txt = readTextFrame(fb);
          if (id === artId && !out.artist) out.artist = txt;
          if (id === titId && !out.title) out.title = txt;
        }
        p += hdrLen + fsize;
        if (out.artist && out.title) break;
      }
    } catch (e) {}
    return out;
  }
  /* muestra/oculta el intérprete bajo el título (solo modo reproductor) */
  function setArtist(text) {
    curArtist = text || "";
    const el = $("#trackArtist");
    if (el) el.textContent = text || "";
    document.body.classList.toggle("has-artist", !!text);
    syncMetaRows();
  }
  // Mantiene SIEMPRE dos filas de info de una línea cada una, pase lo que pase,
  // sin depender del CSS (evita saltos de layout al cambiar de canción):
  //  - reproductor: fila de tiempo OCULTA, fila de intérprete VISIBLE (vacía = espacio)
  //  - LoFi: fila de tiempo VISIBLE, fila de intérprete OCULTA
  function syncMetaRows() {
    const time = document.querySelector(".deck__time");
    const art = $("#trackArtist");
    if (playerOnlyMode) {
      if (time) time.style.display = "none";
      if (art) { art.style.display = "block"; if (!art.textContent) art.textContent = "\u00A0"; }
    } else {
      if (time) time.style.display = "";
      if (art) art.style.display = "none";
    }
  }
  // en modo reproductor: si el ID3 trae intérprete → título arriba + intérprete
  // abajo (se ocultan los contadores). Si no hay intérprete → se deja como estaba.
  function applyTagsNative(ab, name, tok) {
    if (tok !== coverToken) return;
    const fileTitle = name.replace(/\.[^.]+$/, "");
    let artist = "", title = "";
    if (ab) { try { const t = parseTrackTags(ab); artist = t.artist || ""; title = t.title || ""; } catch (e) {} }
    if (tok !== coverToken) return;
    if (artist) { setTrackName(title || fileTitle); setArtist(artist); }
    else { setTrackName(fileTitle); setArtist(""); }
    try { pushMediaState(Engine.playing); } catch (e) {}   // refrescar notificación con los tags
  }

  /* ========================= CARÁTULA (ID3 / FLAC / MP4) ========================= */
  let currentCoverB64 = "";   // base64 jpeg (sin prefijo) de la pista actual; "" = sin carátula
  let coverDirty = false;     // hay carátula nueva que enviar al servicio nativo
  let coverToken = 0;         // descarta extracciones obsoletas si se cambia de pista
  let vizCoverOn = true;      // mostrar carátula difuminada tras el visualizador

  /* Busca una imagen incrustada en el archivo. Devuelve {mime, bytes} o null. */
  function syncsafe(a, o) {
    return ((a[o] & 0x7f) << 21) | ((a[o + 1] & 0x7f) << 14) | ((a[o + 2] & 0x7f) << 7) | (a[o + 3] & 0x7f);
  }
  function deunsync(a) {                      // quita 0x00 tras 0xFF (des-sincronización ID3)
    const out = [];
    for (let i = 0; i < a.length; i++) {
      out.push(a[i]);
      if (a[i] === 0xFF && i + 1 < a.length && a[i + 1] === 0x00) i++;
    }
    return Uint8Array.from(out);
  }

  function parseEmbeddedPicture(ab) {
    try {
      const u8 = new Uint8Array(ab);
      const dv = new DataView(ab);
      // ---- MP3 / ID3v2 (APIC) — soporta v2.2 (PIC), v2.3 y v2.4 ----
      if (u8.length > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
        const ver = u8[3];                 // 2, 3 o 4
        const flags = u8[5];
        const tagSize = syncsafe(u8, 6);
        let tag = u8.subarray(10, Math.min(10 + tagSize, u8.length));
        if (flags & 0x80) tag = deunsync(tag);   // des-sincronización global (v2.2/2.3)

        let p = 0;
        // saltar cabecera extendida (v2.3/2.4)
        if ((ver === 3 || ver === 4) && (flags & 0x40)) {
          if (ver === 4) p += syncsafe(tag, 0);
          else p += 4 + (((tag[0] << 24) | (tag[1] << 16) | (tag[2] << 8) | tag[3]) >>> 0);
        }

        const idLen = ver === 2 ? 3 : 4;
        const hdrLen = ver === 2 ? 6 : 10;
        const picId = ver === 2 ? "PIC" : "APIC";
        const tlen = tag.length;

        while (p + hdrLen <= tlen) {
          if (tag[p] === 0) break;          // relleno (padding)
          let id = "";
          for (let i = 0; i < idLen; i++) id += String.fromCharCode(tag[p + i]);
          let fsize;
          if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
          else if (ver === 4) fsize = syncsafe(tag, p + 4);
          else fsize = ((tag[p + 4] << 24) | (tag[p + 5] << 16) | (tag[p + 6] << 8) | tag[p + 7]) >>> 0;
          if (fsize <= 0 || p + hdrLen + fsize > tlen) break;

          if (id === picId) {
            let off = p + hdrLen, l = fsize, fb;
            if (ver === 4) {
              const f2 = tag[p + 9];
              if (f2 & 0x01) { off += 4; l -= 4; }   // indicador de longitud de datos
              fb = tag.subarray(off, off + l);
              if (f2 & 0x02) fb = deunsync(fb);       // des-sincronización por frame
            } else {
              fb = tag.subarray(off, off + l);
            }
            const pic = readApicFrame(fb, ver === 2);
            if (pic && pic.bytes && pic.bytes.length) return pic;
          }
          p += hdrLen + fsize;
        }
      }
      // ---- FLAC (METADATA PICTURE, type 6) ----
      if (u8.length > 4 && u8[0] === 0x66 && u8[1] === 0x4c && u8[2] === 0x61 && u8[3] === 0x43) {
        let p = 4;
        while (p + 4 <= u8.length) {
          const flag = u8[p];
          const last = (flag & 0x80) !== 0;
          const type = flag & 0x7f;
          const len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
          const body = p + 4;
          if (type === 6) {
            const pic = readFlacPicture(dv, u8, body, len);
            if (pic) return pic;
          }
          p = body + len;
          if (last) break;
        }
      }
      // ---- MP4 / M4A (covr) ----
      const covr = findMp4Covr(dv, u8);
      if (covr) return covr;
    } catch (e) {}
    return null;
  }

  function readApicFrame(fb, legacy) {
    try {
      const len = fb.length;
      let p = 0;
      const enc = fb[p]; p += 1;
      if (legacy) { p += 3; }                          // PIC: formato de imagen (3 chars)
      else { while (p < len && fb[p] !== 0) p++; p++; } // APIC: cadena MIME terminada en 0
      p += 1;                                           // byte de tipo de imagen
      // saltar descripción (terminador según codificación de texto)
      if (enc === 1 || enc === 2) { while (p + 1 < len && !(fb[p] === 0 && fb[p + 1] === 0)) p += 2; p += 2; }
      else { while (p < len && fb[p] !== 0) p++; p += 1; }
      if (p >= len) return null;
      return { mime: "image/*", bytes: fb.subarray(p) };
    } catch (e) { return null; }
  }

  function readFlacPicture(dv, u8, start, len) {
    try {
      let p = start;
      p += 4;                                   // picture type
      const mimeLen = dv.getUint32(p); p += 4;
      p += mimeLen;                             // mime string
      const descLen = dv.getUint32(p); p += 4;
      p += descLen;                            // description
      p += 16;                                 // w,h,depth,colors
      const dataLen = dv.getUint32(p); p += 4;
      const bytes = u8.subarray(p, p + dataLen);
      return { mime: "image/*", bytes };
    } catch (e) { return null; }
  }

  function findMp4Covr(dv, u8) {
    try {
      const n = u8.length;
      for (let i = 0; i + 8 < n; i++) {
        if (u8[i] === 0x63 && u8[i + 1] === 0x6f && u8[i + 2] === 0x76 && u8[i + 3] === 0x72) { // 'covr'
          let p = i + 4;                       // tras el nombre del atom: data atoms
          // el siguiente atom 'data': size(4) 'data'(4) type(4) locale(4) payload
          const dataSize = dv.getUint32(p);
          if (u8[p + 4] === 0x64 && u8[p + 5] === 0x61 && u8[p + 6] === 0x74 && u8[p + 7] === 0x61) {
            const payloadStart = p + 16;
            const payloadEnd = p + dataSize;
            if (payloadEnd <= n && payloadEnd > payloadStart) {
              return { mime: "image/*", bytes: u8.subarray(payloadStart, payloadEnd) };
            }
          }
        }
      }
    } catch (e) {}
    return null;
  }

  /* Redimensiona a máx. 512px y re-codifica JPEG → base64 (cap de tamaño). */
  function shrinkCover(bytes) {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const max = 512;
            let w = img.naturalWidth || 512, h = img.naturalHeight || 512;
            const scale = Math.min(1, max / Math.max(w, h));
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
            const cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(img, 0, 0, w, h);
            const data = cv.toDataURL("image/jpeg", 0.82);
            URL.revokeObjectURL(url);
            resolve(data.slice(data.indexOf(",") + 1));
          } catch (e) { URL.revokeObjectURL(url); resolve(""); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
        img.src = url;
      } catch (e) { resolve(""); }
    });
  }

  /* Extrae la carátula del buffer y la marca para enviar al servicio nativo. */
  async function applyCover(ab, token) {
    let b64 = "";
    try {
      const pic = ab ? parseEmbeddedPicture(ab) : null;
      if (pic && pic.bytes && pic.bytes.length) b64 = await shrinkCover(pic.bytes);
    } catch (e) {}
    if (token !== coverToken) return;     // la pista cambió mientras tanto
    currentCoverB64 = b64;
    coverDirty = true;
    updateVizCover();
    pushMediaState(Engine.playing);       // refresca la notificación con la carátula
  }

  /* pinta (o limpia) la carátula difuminada tras el visualizador */
  function updateVizCover() {
    const img = $("#vizCover"); if (!img) return;
    if (vizCoverOn && currentCoverB64) {
      img.src = "data:image/jpeg;base64," + currentCoverB64;
      img.classList.add("is-set");
    } else {
      img.classList.remove("is-set");
      if (!currentCoverB64) img.removeAttribute("src");
    }
    // mostrar/ocultar botón de carátula
    const btnAw = $("#btnArtwork"); if (btnAw) btnAw.hidden = !currentCoverB64;
  }

  function nativePicker() {
    return typeof window.DSKBridge !== "undefined" &&
           typeof window.DSKBridge.pickAudioFolder === "function";
  }
  /* abre selector: en Android picker nativo (carga toda la carpeta), en web el input */
  function pickAudio() {
    if (nativePicker()) window.DSKBridge.pickAudioFolder();
    else fileInput.click();
  }
  /* abre selector de CARPETA: SAF tree en Android, input webkitdirectory en web */
  function pickFolder() {
    if (typeof window.DSKBridge !== "undefined" && typeof window.DSKBridge.pickFolderTree === "function") {
      window.DSKBridge.pickFolderTree();
    } else if (dirInput) {
      dirInput.click();
    } else if (fileInput) {
      fileInput.click();
    }
  }
  let playlist = [];      // array of { name, file?, nativeIndex?, uri? }
  let plIndex = -1;       // current index
  let shuffle = false;
  let shuffleBag = [];    // remaining indices for shuffle order
  let repeatMode = 0;     // 0 = off · 1 = repetir actual · 2 = repetir todo

  function updateRepeatBtn() {
    const b = $("#btnRepeat"); if (!b) return;
    const st = repeatMode === 1 ? "one" : (repeatMode === 2 ? "all" : "off");
    b.setAttribute("data-state", st);
    const lbl = repeatMode === 1 ? "pl_repeat_one" : (repeatMode === 2 ? "pl_repeat_all" : "pl_repeat_off");
    try { b.setAttribute("aria-label", I18n.t(lbl)); } catch (e) {}
  }
  function setRepeat(mode) {
    repeatMode = ((mode % 3) + 3) % 3;
    try { Engine.setLoop(repeatMode === 1); } catch (e) {}   // "repetir actual" = bucle de la fuente
    try { localStorage.setItem("dsklofi.repeat", String(repeatMode)); } catch (e) {}
    updateRepeatBtn();
  }
  // decide el avance al terminar una pista según el modo de repetición
  // (el modo "repetir actual" se gestiona con Engine.loop, no llega aquí)
  function advanceOnEnd() {
    if (!playlist.length) { setPlayIcon(false); return; }
    if (repeatMode === 2) {                       // repetir todo
      if (playlist.length === 1) loadFile(playlist[plIndex], true);
      else gotoNext(true);
      return;
    }
    // off: avanzar salvo que sea el final de la cola/baraja
    if (playlist.length === 1) { setPlayIcon(false); return; }
    if (shuffle) {
      if (shuffleBag.length) gotoNext(true); else setPlayIcon(false);
    } else {
      if (plIndex < playlist.length - 1) gotoNext(true); else setPlayIcon(false);
    }
  }
  let currentSource = { type: "none", name: "" };   // fuente en curso (file|folder|list)

  /* avisa a la UI (mini-lista / library.js) de cualquier cambio en la cola */
  function emitQueue() {
    try {
      document.dispatchEvent(new CustomEvent("dsk:queue", {
        detail: { length: playlist.length, index: plIndex, source: currentSource }
      }));
    } catch (e) {}
  }

  function buildShuffleBag(excludeCurrent) {
    shuffleBag = playlist.map((_, i) => i);
    if (excludeCurrent && plIndex >= 0) shuffleBag = shuffleBag.filter((i) => i !== plIndex);
    // Fisher-Yates
    for (let i = shuffleBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
    }
  }

  /* fuente web: lista de File del input/drop */
  function setPlaylist(files, startIndex) {
    const audio = Array.from(files).filter((f) => AUDIO_RE.test(f.name) || (f.type && f.type.startsWith("audio")));
    if (!audio.length) { UI.error(I18n.t("err_decode")); return; }
    audio.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    playlist = audio.map((f) => ({ name: f.name, file: f }));
    plIndex = Math.max(0, Math.min(startIndex || 0, playlist.length - 1));
    if (shuffle) buildShuffleBag(true);
    currentSource = { type: "file", name: playlist.length > 1 ? I18n.t("src_files") : playlist[0].name.replace(/\.[^.]+$/, "") };
    renderPlaylist();
    emitQueue();
    loadFile(playlist[plIndex], true);
  }

  /* fuente nativa Android: el Kotlin manda nombres + índice inicial.
     Cada pista se lee bajo demanda vía stream nativo.
     restore: si es objeto {pos, autoplay, shuffle}, restaura sesión previa. */
  window.DSKLoadFolder = function (namesJson, startIndex, restore) {
    try {
      const names = JSON.parse(namesJson);
      if (!Array.isArray(names) || !names.length) return;
      playlist = names.map((n, i) => ({ name: n, nativeIndex: i }));
      plIndex = Math.max(0, Math.min(startIndex || 0, playlist.length - 1));
      const r = restore || null;
      shuffle = !!(r && r.shuffle);
      const sh = $("#btnShuffle"); if (sh) sh.classList.toggle("is-on", shuffle);
      if (shuffle) buildShuffleBag(true);
      pendingRestorePos = (r && r.pos) ? r.pos : 0;
      currentSource = (r && r.source) ? r.source : { type: "folder", name: I18n.t("src_folder") };
      renderPlaylist();
      emitQueue();
      // al restaurar sesión NO autoplay (esperar gesto); al abrir normal sí
      loadFile(playlist[plIndex], r ? !!r.autoplay : true);
    } catch (e) {
      console.warn("DSKLoadFolder failed", e);
      try { if (window.AndroidFileManager) window.AndroidFileManager.showMessage("JS playlist error: " + e.message); } catch (x) {}
    }
  };

  /* fuente nativa por URIs estables (Opción A): el Kotlin manda [{name,uri}]. */
  window.DSKLoadFolderUris = function (itemsJson, startIndex, restore) {
    try {
      const items = JSON.parse(itemsJson);
      if (!Array.isArray(items) || !items.length) return;
      playlist = items.map((it) => ({ name: it.name, uri: it.uri }));
      plIndex = Math.max(0, Math.min(startIndex || 0, playlist.length - 1));
      const r = restore || null;
      shuffle = !!(r && r.shuffle);
      const sh = $("#btnShuffle"); if (sh) sh.classList.toggle("is-on", shuffle);
      if (shuffle) buildShuffleBag(true);
      pendingRestorePos = (r && r.pos) ? r.pos : 0;
      currentSource = (r && r.source) ? r.source : { type: "folder", name: I18n.t("src_folder") };
      renderPlaylist();
      emitQueue();
      loadFile(playlist[plIndex], r ? !!r.autoplay : true);
    } catch (e) {
      console.warn("DSKLoadFolderUris failed", e);
    }
  };

  /* el Kotlin pregunta al arrancar si hay cola guardada para restaurar.
     Devuelve JSON {index, pos, shuffle} o "" si no hay. */
  window.DSKGetSavedQueue = function () {
    const d = readSavedQueue();
    if (!d) return "";
    // las colas por URI se restauran en JS (no por el camino nativo de índices)
    if (d.uris && d.uris.some(function (u) { return u; })) return "";
    try { return JSON.stringify({ index: d.index || 0, pos: d.pos || 0, shuffle: !!d.shuffle, names: d.names }); }
    catch (e) { return ""; }
  };

  /* convierte base64 → ArrayBuffer (fallback) */
  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  /* URL de stream nativo por URI estable (listas/explorador) */
  function uriStreamURL(u, p) { return "https://dsklofi.local/uri/" + encodeURIComponent(u) + (p ? "?p=" + encodeURIComponent(p) : ""); }

  // Si una pista local no se puede leer, casi siempre es por falta de
  // "Acceso a todos los archivos" (p. ej. tras borrar datos). Avisa y lo pide.
  function checkStorageOnFail(track) {
    try {
      if (track && (track.uri || track.path) && window.DSKBridge &&
          typeof DSKBridge.hasAllFiles === "function" && !DSKBridge.hasAllFiles()) {
        if (window.UI && UI.toast) UI.toast(I18n.t("need_all_files"));
        try { DSKBridge.requestAllFiles(); } catch (e) {}
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* obtiene el ArrayBuffer de una pista (web o nativa) */
  async function trackArrayBuffer(track) {
    if (track.file) return await track.file.arrayBuffer();
    if (track.uri) {
      try {
        const res = await fetch(uriStreamURL(track.uri, track.path));
        if (res.ok) return await res.arrayBuffer();
      } catch (e) { /* cae al base64 */ }
      if (typeof window.DSKBridge !== "undefined" &&
          typeof window.DSKBridge.readUri === "function") {
        const b64 = window.DSKBridge.readUri(track.uri);
        if (b64) return b64ToArrayBuffer(b64);
      }
      throw new Error("native uri read failed");
    }
    if (typeof track.nativeIndex === "number") {
      // Preferente: stream HTTP local servido por el WebView (sin límite de tamaño)
      try {
        const res = await fetch("https://dsklofi.local/track/" + track.nativeIndex);
        if (res.ok) return await res.arrayBuffer();
      } catch (e) { /* cae al base64 */ }
      // Fallback: base64 por el puente (solo archivos pequeños)
      if (typeof window.DSKBridge !== "undefined" &&
          typeof window.DSKBridge.readAudioAt === "function") {
        const b64 = window.DSKBridge.readAudioAt(track.nativeIndex);
        if (b64) return b64ToArrayBuffer(b64);
      }
      throw new Error("native read failed");
    }
    throw new Error("no source for track");
  }

  let plQuery = "";
  let plFsOpen = false;
  let dskAnchorActive = false;

  function renderPlaylistInto(host, isFs) {
    if (!host) return;
    const q = plQuery.trim().toLowerCase();
    host.innerHTML = "";
    host.__renderToken = {};
    const token = host.__renderToken;

    // 1) filtrar (barato incluso con cientos de elementos)
    const visible = [];
    playlist.forEach((t, i) => {
      const display = t.name.replace(/\.[^.]+$/, "");
      if (q && display.toLowerCase().indexOf(q) === -1) return;
      visible.push({ i: i, display: display });
    });

    if (q && visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pl-empty";
      empty.textContent = I18n.t("pl_no_results");
      host.appendChild(empty);
      return;
    }

    function makeRow(entry) {
      const i = entry.i, display = entry.display;
      const row = document.createElement("button");
      row.className = "pl-item" + (i === plIndex ? " pl-item--active" : "");
      row.type = "button";
      row.innerHTML = '<span class="pl-item__idx">' + (i + 1) + '</span>' +
        '<span class="pl-item__name"></span>' +
        '<span class="pl-item__menu" role="button" tabindex="0" aria-label="…">' +
        '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg></span>';
      row.querySelector(".pl-item__name").textContent = display;
      row.addEventListener("click", () => {
        plIndex = i; plQuery = ""; syncSearchUI(); renderPlaylist(); emitQueue();
        loadFile(playlist[i], true);
        scrollToActive($("#playlistItems"), false);
        scrollToActive($("#plFsItems"), true);
      });
      const menuBtn = row.querySelector(".pl-item__menu");
      const openMenu = (e) => {
        e.stopPropagation(); e.preventDefault();
        document.dispatchEvent(new CustomEvent("dsk:trackmenu", { detail: { index: i, isFs: !!isFs } }));
      };
      menuBtn.addEventListener("click", openMenu);
      menuBtn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openMenu(e); });
      return row;
    }

    // 2) primer lote SÍNCRONO alrededor de la pista activa, para que
    //    scrollToActive() funcione de inmediato sin esperar al resto.
    const FIRST = 60;
    let activePos = visible.findIndex((e) => e.i === plIndex);
    let startPos = 0;
    if (activePos >= 0) startPos = Math.max(0, Math.min(activePos - Math.floor(FIRST / 2), Math.max(0, visible.length - FIRST)));
    const firstEnd = Math.min(visible.length, startPos + FIRST);

    const fragFirst = document.createDocumentFragment();
    for (let k = startPos; k < firstEnd; k++) fragFirst.appendChild(makeRow(visible[k]));
    host.appendChild(fragFirst);

    // 3) resto en chunks (antes y después del bloque ya pintado)
    let beforeIdx = startPos - 1;
    let afterIdx = firstEnd;
    const CHUNK = 60;
    function step() {
      if (host.__renderToken !== token) return;
      let work = 0;
      // después: añadir al final
      while (afterIdx < visible.length && work < CHUNK) {
        host.appendChild(makeRow(visible[afterIdx]));
        afterIdx++; work++;
      }
      // antes: insertar al principio (orden inverso → insertBefore del primer hijo)
      while (beforeIdx >= 0 && work < CHUNK * 2) {
        host.insertBefore(makeRow(visible[beforeIdx]), host.firstChild);
        beforeIdx--; work++;
      }
      if (afterIdx < visible.length || beforeIdx >= 0) requestAnimationFrame(step);
    }
    if (afterIdx < visible.length || beforeIdx >= 0) requestAnimationFrame(step);
  }

  // hace scroll a la pista activa dentro de su contenedor de forma aislada
    function scrollToActive(host, isFs) {
      if (!host) return;
      if (isFs && $("#plFs").hidden) return;     // la grande solo si está abierta
      const active = host.querySelector(".pl-item--active");
      if (!active) return;

      // esperar al layout para que el cálculo sea correcto
      requestAnimationFrame(() => {
        try {
          // Obtenemos las posiciones reales en pantalla del contenedor y del ítem
          const hostRect = host.getBoundingClientRect();
          const activeRect = active.getBoundingClientRect();

          // Calculamos cuántos píxeles separan el elemento del inicio del contenedor
          const offset = activeRect.top - hostRect.top;

          // Sumamos esa diferencia al scroll actual, ajustando para que quede en el centro
          host.scrollTop += (offset - (hostRect.height / 2) + (activeRect.height / 2));
        } catch (e) {}
      });
    }

  function renderPlaylist() {
    const wrap = $("#playlist");
    // La mini-lista permanece SIEMPRE visible con su tamaño fijo, tenga o no
    // contenido, para que la interfaz nunca se redimensione ni se pierdan controles.
    wrap.hidden = false;
    if (!playlist.length) {
      $("#playlistCount").textContent = "0 / 0";
      $("#playlistItems").innerHTML = "";
      return;
    }
    const count = (plIndex + 1) + " / " + playlist.length;
    $("#playlistCount").textContent = count;
    renderPlaylistInto($("#playlistItems"), false);
    scrollToActive($("#playlistItems"), false);
    // si la lista fullscreen está abierta, repintarla también
    if (!$("#plFs").hidden) {
      $("#plFsCount").textContent = count;
      renderPlaylistInto($("#plFsItems"), true);
      scrollToActive($("#plFsItems"), true);
    }
  }

  function syncSearchUI() {
    const inp = $("#plSearch"), clr = $("#plSearchClear");
    if (inp && inp.value !== plQuery) inp.value = plQuery;
    if (clr) clr.hidden = !plQuery;
    const fInp = $("#plFsSearch"), fClr = $("#plFsSearchClear");
    if (fInp && fInp.value !== plQuery) fInp.value = plQuery;
    if (fClr) fClr.hidden = !plQuery;
  }

  function openPlFs() {
    $("#plFsCount").textContent = playlist.length ? ((plIndex + 1) + " / " + playlist.length) : "";
    renderPlaylistInto($("#plFsItems"), true);
    syncSearchUI();
    $("#plFs").hidden = false;
    document.body.classList.add("plfs-open");
    plFsOpen = true;
    if (playlist.length) scrollToActive($("#plFsItems"), true);   // centrar en la pista activa
    // asegurar colchón en el history para que el botón atrás cierre la lista
    if (!dskAnchorActive) {
      dskAnchorActive = true;
      try { history.pushState({ dskAnchor: true }, ""); } catch (e) {}
    }
  }
  function closePlFs() {
    if ($("#plFs").hidden) return;
    $("#plFs").hidden = true;
    document.body.classList.remove("plfs-open");
    plFsOpen = false;
  }

  /* ====== API de cola para library.js (pestañas/explorador/listas) ====== */
  function plItemFrom(o) {
    if (!o) return null;
    if (o.ytId) return { name: o.name, ytId: o.ytId, uploader: o.uploader || "", thumb: o.thumb || "" };
    if (o.file) return { name: o.name || o.file.name, file: o.file };
    if (o.uri) return { name: o.name, uri: o.uri, path: o.path || null };
    if (typeof o.nativeIndex === "number") return { name: o.name, nativeIndex: o.nativeIndex };
    return null;
  }
  function loadItems(items, startIndex, source, autoplay, restorePos, prepareOnly) {
    const list = (items || []).map(plItemFrom).filter(Boolean);
    if (!list.length) return;
    playlist = list;
    plIndex = Math.max(0, Math.min(startIndex || 0, playlist.length - 1));
    if (shuffle) buildShuffleBag(true);
    currentSource = source || { type: "folder", name: "" };
    pendingRestorePos = (restorePos && restorePos > 0.3) ? restorePos : 0;
    ytPendingResolve = false;
    renderPlaylist(); emitQueue();
    loadFile(playlist[plIndex], autoplay !== false, prepareOnly === true);
  }
  function playAt(i) {
    if (i < 0 || i >= playlist.length) return;
    ytPendingResolve = false;
    plIndex = i; plQuery = ""; syncSearchUI(); renderPlaylist(); emitQueue();
    loadFile(playlist[i], true);
  }
  function enqueueNext(items) {
    const list = (items || []).map(plItemFrom).filter(Boolean);
    if (!list.length) return;
    const at = (plIndex >= 0 ? plIndex : -1) + 1;
    playlist.splice(at, 0, ...list);
    if (shuffle) buildShuffleBag(false);
    renderPlaylist(); emitQueue(); saveQueue();
  }
  function enqueueLast(items) {
    const list = (items || []).map(plItemFrom).filter(Boolean);
    if (!list.length) return;
    playlist.push(...list);
    if (shuffle) buildShuffleBag(false);
    renderPlaylist(); emitQueue(); saveQueue();
  }
  function removeAt(i) {
    if (i < 0 || i >= playlist.length) return;
    const wasCurrent = (i === plIndex);
    playlist.splice(i, 1);
    if (i < plIndex) plIndex--;
    if (!playlist.length) { plIndex = -1; }
    else {
      plIndex = Math.min(plIndex, playlist.length - 1);
      if (wasCurrent) loadFile(playlist[plIndex], Engine.playing);
    }
    if (shuffle) buildShuffleBag(false);
    renderPlaylist(); emitQueue(); saveQueue();
  }
  function moveItem(from, to) {
    const cur = (plIndex >= 0) ? playlist[plIndex] : null;
    if (from < 0 || from >= playlist.length || to < 0 || to >= playlist.length || from === to) return;
    const it = playlist.splice(from, 1)[0];
    playlist.splice(to, 0, it);
    if (cur) plIndex = playlist.indexOf(cur);
    if (shuffle) buildShuffleBag(false);
    renderPlaylist(); emitQueue(); saveQueue();
  }
  window.DSKQueue = {
    snapshot() {
      return {
        items: playlist.map((t, i) => ({
          name: t.name,
          uri: t.uri || null,
          nativeIndex: (typeof t.nativeIndex === "number" ? t.nativeIndex : null),
          ytId: t.ytId || null,
          uploader: t.uploader || null,
          thumb: t.thumb || null,
          active: i === plIndex
        })),
        index: plIndex,
        source: currentSource
      };
    },
    load: loadItems,
    playAt: playAt,
    enqueueNext: enqueueNext,
    enqueueLast: enqueueLast,
    remove: removeAt,
    move: moveItem,
    open() { openPlFs(); },
    close() { closePlFs(); },
    isOpen() { return !$("#plFs").hidden; },
    /* pistas con URI estable (para guardar como lista) */
    stableItems() { return playlist.filter((t) => t.uri).map((t) => ({ name: t.name, uri: t.uri })); }
  };

  /* ====== botón ATRÁS del dispositivo (lo invoca MainActivity) ======
     Manejadores jerárquicos: library.js registra los suyos (modal → nivel
     explorador → lista). Si nadie consume, cerramos la lista a pantalla
     completa para volver a la principal en vez de salir de la app. */
  window.__dskBackStack = window.__dskBackStack || [];
  window.DSKHandleBack = function () {
    // 1) modal abierto → cerrar el que esté más arriba (mayor z-index)
    const open = Array.prototype.slice.call(document.querySelectorAll(".modal.modal--open"));
    if (open.length) {
      let top = open[0], z = -Infinity;
      open.forEach((m) => {
        const zz = parseInt(getComputedStyle(m).zIndex, 10) || 0;
        if (zz >= z) { z = zz; top = m; }
      });
      // el modal de letras: primero volver a la lista de resultados (si la hay)
      if ((top.id === "lyricsModal" || top.id === "karaokeModal") && window.Lyrics && Lyrics.back) { Lyrics.back(); return true; }
      if (window.UI && UI.closeModal) UI.closeModal(top.id);
      else { top.classList.remove("modal--open"); top.setAttribute("aria-hidden", "true"); }
      return true;
    }
    // 2) handlers registrados: suben UN nivel dentro de la biblioteca
    //    (subcarpeta → arriba, detalle de lista → índice, combos/menús…)
    const stack = window.__dskBackStack;
    for (let i = stack.length - 1; i >= 0; i--) {
      try { if (stack[i]()) return true; } catch (e) {}
    }
    // 3) biblioteca a pantalla completa, ya en su nivel raíz → cerrar
    if (!$("#plFs").hidden) { closePlFs(); return true; }
    // 4) si la página está desplazada hacia abajo → volver arriba
    const se = document.scrollingElement || document.documentElement;
    if (se && se.scrollTop > 8) { window.scrollTo({ top: 0, behavior: "smooth" }); return true; }
    // 5) nada que cerrar → que la app pregunte si salir
    return false;
  };

  function gotoNext(auto) {
    if (!playlist.length) return;
    if (shuffle) {
      if (!shuffleBag.length) buildShuffleBag(true);
      plIndex = shuffleBag.shift();
    } else {
      plIndex = (plIndex + 1) % playlist.length;
    }
    renderPlaylist();
    loadFile(playlist[plIndex], true);
  }

  function gotoPrev() {
    if (!playlist.length) return;
    if (shuffle) {
      if (!shuffleBag.length) buildShuffleBag(true);
      plIndex = shuffleBag.shift();
    } else {
      plIndex = (plIndex - 1 + playlist.length) % playlist.length;
    }
    renderPlaylist();
    emitQueue();
    loadFile(playlist[plIndex], true);
  }

  /* ====== persistencia de cola entre sesiones (solo fuente nativa) ====== */
  const QUEUE_KEY = "dsklofi.queue";
  function saveQueue() {
    try {
      const hasUri = playlist.length && playlist.some(function (t) { return t.uri; });
      const isNative = playlist.length && typeof playlist[0].nativeIndex === "number";
      const hasYt = playlist.length && playlist.some(function (t) { return t.ytId; });
      // colas web (File) no son serializables; el resto (uri/nativeIndex/ytId) sí
      if (!playlist.length || (!hasUri && !isNative && !hasYt)) { localStorage.removeItem(QUEUE_KEY); return; }
      const data = {
        names: playlist.map(function (t) { return t.name; }),
        uris: playlist.map(function (t) { return t.uri || null; }),
        ytIds: playlist.map(function (t) { return t.ytId || null; }),
        uploaders: playlist.map(function (t) { return t.uploader || null; }),
        thumbs: playlist.map(function (t) { return t.thumb || null; }),
        index: plIndex,
        pos: (Engine.nativeMode || Engine.buffer) ? Engine.position() : 0,
        shuffle: shuffle,
        source: currentSource
      };
      localStorage.setItem(QUEUE_KEY, JSON.stringify(data));
    } catch (e) {}
  }
  function readSavedQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.names) || !d.names.length) return null;
      return d;
    } catch (e) { return null; }
  }
  let pendingRestorePos = 0;   // posición a restaurar tras cargar la pista

  // Pone la miniatura de YouTube como carátula (notificación + fondo del viz).
  async function ytSetCover(thumbUrl, tok) {
    try {
      const res = await fetch(thumbUrl);
      const blob = await res.blob();
      // normalizar a JPEG (la miniatura puede venir en webp); así el APIC del
      // MP3 exportado es siempre válido y la notificación nativa la acepta.
      const buf = await blob.arrayBuffer();
      let b64 = await shrinkCover(new Uint8Array(buf));
      if (!b64) {
        // fallback: usar el blob tal cual si shrinkCover no pudo decodificar
        b64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      }
      if (tok !== coverToken) return;
      currentCoverB64 = b64; coverDirty = true;
      updateVizCover();
      pushMediaState(Engine.playing);
    } catch (e) {}
  }

  // El archivo de esta pista ya no existe en disco: la quitamos de la cola
  // (y de las listas guardadas que la contengan) y saltamos a la siguiente,
  // sin re-escanear nada. Evita el "congelado" al refrescar carpetas grandes.
  function skipMissingTrack(track, autoplay) {
    const isLocal = !!(track && (track.uri || track.path));
    if (!isLocal) { UI.error(I18n.t("err_decode")); return; }

    const i = playlist.indexOf(track);
    if (i === -1) return; // ya se gestionó (p. ej. error duplicado del <audio>)

    playlist.splice(i, 1);
    try { removeFromSavedLists(track); } catch (e) {}

    if (window.UI) UI.toast(I18n.t("file_missing_skipped"));

    if (!playlist.length) {
      plIndex = 0;
      renderPlaylist(); emitQueue(); saveQueue();
      document.body.classList.remove("has-track");
      $("#loaderBusy").hidden = true; $("#waveBusy").hidden = true; $("#loaderIdle").hidden = false;
      return;
    }

    if (i < plIndex) plIndex--;
    else if (i === plIndex) {
      if (plIndex >= playlist.length) plIndex = 0;
      renderPlaylist(); emitQueue(); saveQueue();
      loadFile(playlist[plIndex], autoplay);
      return;
    }
    renderPlaylist(); emitQueue(); saveQueue();
  }

  // Quita una pista (por uri) de todas las playlists guardadas en localStorage,
  // para que no vuelva a aparecer la próxima vez que se abra esa lista.
  function removeFromSavedLists(track) {
    if (!track || !track.uri || !window.localStorage) return;
    const KEY = "dsklofi.playlists";
    let lists;
    try { lists = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return; }
    if (!Array.isArray(lists)) return;
    let changed = false;
    lists.forEach((l) => {
      if (!l || !Array.isArray(l.items)) return;
      const before = l.items.length;
      l.items = l.items.filter((it) => !it || it.uri !== track.uri);
      if (l.items.length !== before) changed = true;
    });
    if (changed) {
      try { localStorage.setItem(KEY, JSON.stringify(lists)); } catch (e) {}
      try { if (window.DSKLib && DSKLib.refresh) DSKLib.refresh(); } catch (e) {}
    }
  }

  async function loadFile(track, autoplay, prepareOnly) {
    if (!track) return;
    // compat: si llega un File directo (web antiguo), envolverlo
    if (track instanceof File) track = { name: track.name, file: track };
    // YouTube: requiere modo reproductor (audio remoto). Cambia sin recargar.
    if (track.ytId && !playerOnlyMode && applyPlayerOnlyRef) { applyPlayerOnlyRef(true, false); syncModeUI(); }
    const hadTrack = document.body.classList.contains("has-track");
    $("#loaderIdle").hidden = true;
    // nueva pista: limpiar la carátula previa (la 1ª notificación mostrará el logo)
    currentCoverB64 = ""; coverDirty = true;
    curDurationOverride = 0;   // se fija abajo solo para YouTube
    updateVizCover();
    const coverTok = ++coverToken;

    // ---- YT restaurado en frío: preparar SIN resolver el stream (la URL de
    //      YouTube caduca). Se deja la pista lista; al pulsar play se recarga. ----
    if (prepareOnly && track.ytId) {
      ytPendingResolve = true;
      document.body.classList.add("has-track");
      sizeCanvases();
      setTrackName(track.name.replace(/\.[^.]+$/, ""));
      setArtist(track.uploader || "");
      $("#timeCur").textContent = fmt.time(0);
      peaks = null;
      setPlayIcon(false);
      if (track.thumb) ytSetCover(track.thumb, coverTok);
      $("#loaderBusy").hidden = true; $("#waveBusy").hidden = true; $("#loaderIdle").hidden = true;
      return;
    }

    // ---- modo solo reproductor: carga instantánea con <audio> nativo ----
    if (playerOnlyMode) {
      try {
        let url;
        let coverBlob = track.file || null;
        if (track.file) {
          url = URL.createObjectURL(track.file);
        } else if (track.uri) {
          try {
            const res = await fetch(uriStreamURL(track.uri, track.path));
            const blob = await res.blob();
            coverBlob = blob;
            url = URL.createObjectURL(blob);
          } catch (e) {
            url = uriStreamURL(track.uri, track.path);   // fallback stream
          }
        } else if (typeof track.nativeIndex === "number") {
          // descargar el stream a un blob para que el <audio> pueda hacer seek
          // (el stream del WebView no soporta peticiones por rango → sin seek)
          try {
            const res = await fetch("https://dsklofi.local/track/" + track.nativeIndex);
            const blob = await res.blob();
            coverBlob = blob;
            url = URL.createObjectURL(blob);
          } catch (e) {
            url = "https://dsklofi.local/track/" + track.nativeIndex;   // fallback stream
          }
        } else if (track.ytId) {
          // YouTube: resolver la URL de audio AL REPRODUCIR (caduca). Stream remoto
          // (soporta peticiones por rango → seek correcto).
          let info = null, errMsg = "";
          try { info = window.DSKYT ? await DSKYT.resolve(track.ytId) : null; }
          catch (e) { errMsg = String(e == null ? "" : e); info = null; }
          if (!info || !info.url) {
            if (window.UI) UI.toast(I18n.t("on_error") + (errMsg ? " — " + errMsg : ""));
            $("#loaderBusy").hidden = true; $("#waveBusy").hidden = true; $("#loaderIdle").hidden = false;
            return;
          }
          url = info.url;
          if (info.uploader && !track.uploader) track.uploader = info.uploader;
          if (info.duration && info.duration > 0) curDurationOverride = info.duration;
          if (info.thumb && !track.thumb) track.thumb = info.thumb;
        }
        const a = nativeAudio;
        if (nativeUrlObj) { try { URL.revokeObjectURL(nativeUrlObj); } catch (e) {} nativeUrlObj = null; }
        if (url && url.startsWith("blob:")) nativeUrlObj = url;
        a.src = url;
        a.playbackRate = Engine.speed || 1;
        document.body.classList.add("has-track");
        sizeCanvases();
        setTrackName(track.name.replace(/\.[^.]+$/, ""));
        setArtist("");   // hasta saber si el tag trae intérprete
        $("#timeCur").textContent = fmt.time(0);
        peaks = null;   // sin forma de onda decodificada en modo nativo
        setPlayIcon(false);
        // carátula + tags (no bloquea la reproducción)
        if (coverBlob) coverBlob.arrayBuffer()
          .then((ab) => { applyCover(ab, coverTok); applyTagsNative(ab, track.name, coverTok); })
          .catch(() => {});
        else applyCover(null, coverTok);
        if (track.ytId) { setArtist(track.uploader || ""); if (track.thumb) ytSetCover(track.thumb, coverTok); }
        if (pendingRestorePos > 0.3) { a.addEventListener("loadedmetadata", () => { try { a.currentTime = pendingRestorePos; } catch (e) {} pendingRestorePos = 0; }, { once: true }); }
        else pendingRestorePos = 0;
        if (autoplay) { await Engine.play(); setPlayIcon(true); }
        applyTrackNormNative(track.name, coverBlob);
        saveQueue();
      } catch (err) {
        console.warn("native load failed", err);
        if (!checkStorageOnFail(track)) { skipMissingTrack(track, autoplay); return; }
      } finally {
        $("#loaderBusy").hidden = true; $("#waveBusy").hidden = true; $("#loaderIdle").hidden = false;
      }
      return;
    }

    // si ya hay onda visible (cambio de pista) → overlay sobre la onda;
    // si es la primera carga → loader de abajo
    if (hadTrack) $("#waveBusy").hidden = false;
    else $("#loaderBusy").hidden = false;
    try {
      const ab = await trackArrayBuffer(track);
      // carátula ANTES de decodificar: decodeAudioData "neutraliza" el ArrayBuffer
      applyCover(ab, coverTok);
      const buf = await Engine.decode(ab);
      Engine.setBuffer(buf, track.name);
      applyTrackNormLofi(track.name, buf);
      peaks = Engine.getPeaks(160);
      document.body.classList.add("has-track");
      sizeCanvases(); /* containers were display:none until now */
      setTrackName(track.name.replace(/\.[^.]+$/, ""));
      setArtist("");
      $("#timeTotal").textContent = fmt.time(buf.duration);
      $("#timeCur").textContent = fmt.time(0);
      const base = sanitize(track.name.replace(/\.[^.]+$/, "")) + " [DSKLoFi]";
      $("#exportName").value = base;
      setPlayIcon(false);
      drawWave();
      // restaurar posición guardada (al reabrir la app)
      if (pendingRestorePos > 0.3 && pendingRestorePos < buf.duration - 0.2) {
        Engine.seek(pendingRestorePos / buf.duration);
        $("#timeCur").textContent = fmt.time(pendingRestorePos);
        drawWave();
      }
      pendingRestorePos = 0;
      if (autoplay) { await Engine.play(); setPlayIcon(true); }
      saveQueue();
    } catch (err) {
      console.warn("decode failed", err);
      if (!checkStorageOnFail(track)) skipMissingTrack(track, autoplay);
    } finally {
      $("#loaderBusy").hidden = true;
      $("#waveBusy").hidden = true;
      $("#loaderIdle").hidden = false;
    }
  }

  function sanitize(s) {
    return s.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "dsk-lofi";
  }

  /* ========================= TRANSPORT ========================= */
  const SVG_PLAY = '<svg class="ic ic--solid" viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 4.5 20 12 8 19.5"></polygon></svg>';
  const SVG_PAUSE = '<svg class="ic ic--solid" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.4" height="14" rx="1"></rect><rect x="13.6" y="5" width="4.4" height="14" rx="1"></rect></svg>';

  function setPlayIcon(playing) {
    $("#btnPlay").classList.toggle("is-playing", playing);
    $("#playGlyph").innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    $("#btnPlay").setAttribute("aria-label", I18n.t(playing ? "pause" : "play"));
    document.body.classList.toggle("is-playing", playing);
    pushMediaState(playing);
  }

  /* notifica el estado a la notificación nativa (Android) */
  function pushMediaState(playing) {
    try {
      if (typeof window.AndroidMedia !== "undefined" &&
          typeof window.AndroidMedia.update === "function") {
        const title = curTitle || (Engine.fileName || "DSK•LoFi").replace(/\.[^.]+$/, "");
        const artist = curArtist || (playlist.length > 1
          ? (I18n.t("playlist") + " " + (plIndex + 1) + "/" + playlist.length)
          : "lofi tape machine");
        const payload = { playing: !!playing, title, artist };
        // duración/posición (segundos) para la barra de la notificación
        const dur = curDurationOverride > 0 ? curDurationOverride : (Engine.duration || 0);
        payload.duration = Math.max(0, Math.round(dur));
        payload.position = Math.max(0, Math.round(Engine.position() || 0));
        // la carátula solo se envía cuando cambia (evita reenviar base64 grande)
        if (coverDirty) { payload.cover = currentCoverB64; coverDirty = false; }
        window.AndroidMedia.update(JSON.stringify(payload));
      }
    } catch (e) {}
  }

  /* controles invocados desde la notificación / auriculares / pantalla bloqueada */
  window.DSKControls = {
    async toggle() {
      if (ytPendingResolve && playlist[plIndex] && playlist[plIndex].ytId) {
        ytPendingResolve = false; await loadFile(playlist[plIndex], true); return;
      }
      const loaded = playerOnlyMode ? !!nativeAudio.src : !!Engine.buffer;
      if (!loaded) return;
      if (Engine.playing) { setPlayIcon(false); await Engine.pause(); }
      else { await Engine.play(); setPlayIcon(true); keepAliveOn(); }
    },
    // orden determinista e idempotente (la usa la notificación: play/pause según destino)
    async setPlaying(want) {
      want = (want === true || want === "true");
      if (want && ytPendingResolve && playlist[plIndex] && playlist[plIndex].ytId) {
        ytPendingResolve = false; await loadFile(playlist[plIndex], true); return;
      }
      const loaded = playerOnlyMode ? !!nativeAudio.src : !!Engine.buffer;
      if (!loaded) return;
      if (Engine.playing === want) return;
      if (want) { await Engine.play(); setPlayIcon(true); keepAliveOn(); }
      else { setPlayIcon(false); await Engine.pause(); }
    },
    next() { if (playlist.length) gotoNext(); },
    prev() { if (playlist.length) gotoPrev(); },
    seek(sec) {
      const loaded = playerOnlyMode ? !!nativeAudio.src : !!Engine.buffer;
      if (!loaded) return;
      const dur = curDurationOverride > 0 ? curDurationOverride : (Engine.duration || 0);
      if (dur > 0) { Engine.seek(Math.max(0, Math.min(sec, dur)) / dur); pushMediaState(Engine.playing); }
    }
  };

  function bindTransport() {
    $("#btnPlay").addEventListener("click", async () => {
      // cola de YouTube restaurada en frío: aún no se resolvió el stream.
      // Al pulsar play, cargamos de verdad la pista actual y la reproducimos.
      if (ytPendingResolve && playlist[plIndex] && playlist[plIndex].ytId) {
        ytPendingResolve = false;
        await loadFile(playlist[plIndex], true);
        return;
      }
      // ¿hay pista cargada? en modo reproductor el audio va por <audio> (sin Engine.buffer)
      const loaded = playerOnlyMode ? !!nativeAudio.src : !!Engine.buffer;
      if (!loaded) { pickAudio(); return; }
      if (Engine.playing) { setPlayIcon(false); await Engine.pause(); }
      else { await Engine.play(); setPlayIcon(true); keepAliveOn(); }
    });

    $("#btnEject").addEventListener("click", () => { try { DSKQueue.open(); } catch (e) {} });
    const plFsOpenFile = $("#plFsOpenFile");
    if (plFsOpenFile) plFsOpenFile.addEventListener("click", pickAudio);

    /* buscador de playlist */
    const plSearch = $("#plSearch"), plSearchClear = $("#plSearchClear");
    if (plSearch) {
      plSearch.addEventListener("input", () => {
        plQuery = plSearch.value || "";
        syncSearchUI();
        renderPlaylist();
      });
      plSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); plSearch.blur(); }
      });
      plSearchClear.addEventListener("click", () => {
        plQuery = ""; syncSearchUI(); renderPlaylist(); plSearch.focus();
      });
    }

    /* lista a pantalla completa */
    const plTitleBtn = $("#plTitleBtn");
    if (plTitleBtn) plTitleBtn.addEventListener("click", openPlFs);
    $("#plFsClose").addEventListener("click", () => closePlFs());
    const plFsSearch = $("#plFsSearch"), plFsSearchClear = $("#plFsSearchClear");
    if (plFsSearch) {
      plFsSearch.addEventListener("input", () => {
        plQuery = plFsSearch.value || "";
        syncSearchUI();
        renderPlaylist();
      });
      plFsSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); plFsSearch.blur(); }
      });
      plFsSearchClear.addEventListener("click", () => {
        plQuery = ""; syncSearchUI(); renderPlaylist(); plFsSearch.focus();
      });
    }
    // botón atrás del dispositivo: cierra la lista a pantalla completa.
    // Colchón en el history puesto una vez al arrancar (sin sonido aún) y
    // repuesto solo tras consumirlo, para no hacer pushState durante la
    // reproducción continua (eso interrumpía el audio en WebView).
    dskAnchorActive = true;
    try { history.pushState({ dskAnchor: true }, ""); } catch (e) {}

    // Quita de la cola los archivos locales que ya no existen (borrados fuera de
    // la app). Solo valida items con uri (YouTube/seleccionados no tienen) → barato.
    // Al volver a la app (primer plano): refrescar las vistas abiertas (cola,
    // explorador, listas) por si cambió algo mientras estaba en segundo plano.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      try { renderPlaylist(); } catch (e) {}
      try { if (window.DSKLib && DSKLib.refresh) DSKLib.refresh(); } catch (e) {}
    });

    window.addEventListener("popstate", () => {
      dskAnchorActive = false;   // el colchón se consumió
      const handled = (typeof window.DSKHandleBack === "function") ? window.DSKHandleBack() : false;
      if (handled) {
        dskAnchorActive = true;
        try { history.pushState({ dskAnchor: true }, ""); } catch (e) {}
      }
    });

    /* velocidad: abre modal con presets + slider manual */
    function applySpeedLabel() {
      const s = Engine.speed || 1;
      $("#btnSpeed").textContent = (s === 1 ? "1" : String(s).replace(/^0/, "")) + "×";
      $("#btnSpeed").classList.toggle("is-on", s !== 1);
    }
    window.__applySpeedLabel = applySpeedLabel;
    function syncSpeedModal() {
      const s = Engine.speed || 1;
      $("#speedSlider").value = s;
      $("#speedVal").textContent = s.toFixed(2) + "×";
      $$("#speedPresets .chip").forEach((c) => {
        c.classList.toggle("is-on", Math.abs(parseFloat(c.getAttribute("data-spd")) - s) < 0.001);
      });
    }
    function setSpeedVal(v) {
      Engine.setSpeed(v);
      applySpeedLabel();
      syncSpeedModal();
      try { localStorage.setItem("dsklofi.speed", String(Engine.speed)); } catch (e) {}
    }
    try { const sv = parseFloat(localStorage.getItem("dsklofi.speed") || "1"); if (sv >= 0.5 && sv <= 2) Engine.speed = sv; } catch (e) {}
    applySpeedLabel();
    $("#btnSpeed").addEventListener("click", () => { syncSpeedModal(); UI.openModal("speedModal"); });

    /* botón anular voz (karaoke), solo visible en modo reproductor.
       Toque = activar/desactivar. Mantener pulsado = abrir modal de ajustes. */
    function syncVoiceBtn() {
      const b = $("#btnVoice");
      if (b) b.classList.toggle("is-on", !!(window.Engine && Engine.karaokeOn));
    }
    const btnVoice = $("#btnVoice");
    if (btnVoice) {
      let voxLongPress = false, voxTimer = null;
      const LONG_MS = 500;
      const startPress = () => {
        voxLongPress = false;
        voxTimer = setTimeout(() => { voxLongPress = true; openVoiceModal(); }, LONG_MS);
      };
      const endPress = () => {
        if (voxTimer) { clearTimeout(voxTimer); voxTimer = null; }
      };
      // pointer cubre touch y ratón
      btnVoice.addEventListener("pointerdown", startPress);
      btnVoice.addEventListener("pointerup", endPress);
      btnVoice.addEventListener("pointerleave", endPress);
      btnVoice.addEventListener("pointercancel", endPress);
      btnVoice.addEventListener("click", (e) => {
        if (voxLongPress) { voxLongPress = false; e.preventDefault(); return; }  // fue long-press → no togglear
        try { if (window.Engine && Engine.setKaraoke) Engine.setKaraoke(!Engine.karaokeOn); } catch (e) {}
      });
      // evitar menú contextual del navegador al mantener pulsado
      btnVoice.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    document.addEventListener("dsk:karaoke", syncVoiceBtn);
    syncVoiceBtn();
    initVoiceModal();
    $$("#speedPresets .chip").forEach((c) => {
      c.addEventListener("click", () => setSpeedVal(parseFloat(c.getAttribute("data-spd"))));
    });
    $("#speedSlider").addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      $("#speedVal").textContent = v.toFixed(2) + "×";
      Engine.setSpeed(v);
      applySpeedLabel();
      $$("#speedPresets .chip").forEach((c) => c.classList.toggle("is-on", Math.abs(parseFloat(c.getAttribute("data-spd")) - v) < 0.001));
      try { localStorage.setItem("dsklofi.speed", String(Engine.speed)); } catch (e) {}
    });

    /* visualizer mode (ojo): abre el selector */
    try { const vm = parseInt(localStorage.getItem("dsklofi.viz") || "0", 10); if (vm >= 0 && vm < VIZ_MODES) vizMode = vm; } catch (e) {}
    $("#btnVizMode").addEventListener("click", openVizPicker);

    /* ---- letras: botón LYRIC abre el modal con la pista actual ---- */
    const btnLyrics = $("#btnLyrics");
    if (btnLyrics) btnLyrics.addEventListener("click", () => {
      if (window.Lyrics) Lyrics.open(curTitle, curArtist);
    });

    /* ---- tocar el título/intérprete (entre las bobinas) → portapapeles ---- */
    function copyNowPlaying() {
      const title = curTitle || "";
      const artist = curArtist || "";
      const text = ((artist ? artist + " - " : "") + title).trim();
      if (!text) return;
      let ok = false;
      try { if (window.DSKBridge && DSKBridge.copyToClipboard) { DSKBridge.copyToClipboard(text); ok = true; } } catch (e) {}
      if (!ok) { try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); ok = true; } } catch (e) {} }
      if (!ok) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.focus(); ta.select();
          document.execCommand("copy"); ta.remove(); ok = true;
        } catch (e) {}
      }
      if (ok && window.UI) UI.toast(I18n.t("copied"));
    }
    const deckMeta = document.querySelector(".deck__meta");
    if (deckMeta) deckMeta.addEventListener("click", copyNowPlaying);
    $("#vizPickOk").addEventListener("click", () => UI.closeModal("vizPickModal"));

    /* carátula de fondo tras el visualizador (toggle en el selector) */
    try { vizCoverOn = localStorage.getItem("dsklofi.vizcover") !== "0"; } catch (e) {}
    const vizCoverToggle = $("#vizCoverToggle");
    function applyVizCoverPref() {
      if (vizCoverToggle) vizCoverToggle.classList.toggle("is-on", vizCoverOn);
      updateVizCover();
    }
    applyVizCoverPref();
    if (vizCoverToggle) vizCoverToggle.addEventListener("click", () => {
      vizCoverOn = !vizCoverOn;
      try { localStorage.setItem("dsklofi.vizcover", vizCoverOn ? "1" : "0"); } catch (e) {}
      applyVizCoverPref();
    });

    buildVizGrid();

    const btnMode = $("#btnMode");
    if (btnMode) btnMode.addEventListener("click", () => { requestMode(!playerOnlyMode); });

    /* prev / next / stop */
    // Toque corto = pista anterior/siguiente. Mantener pulsado = retroceder/
    // avanzar dentro de la pista actual (tipo << / >>), con aceleración.
    function attachHoldSeek(btn, dir, shortAction) {
      if (!btn) return;
      let holdTimer = 0, stepTimer = 0, didSeek = false, accel = 0;
      const HOLD = 350, TICK = 220, BASE = 5;
      const loaded = () => playerOnlyMode ? !!nativeAudio.src : !!Engine.buffer;
      const curDur = () => (curDurationOverride > 0 ? curDurationOverride : (Engine.duration || 0));
      function stepOnce() {
        if (!loaded()) return;
        const dur = curDur(); if (dur <= 0) return;
        accel++;
        const step = BASE + Math.min(15, Math.floor(accel / 4) * 5); // 5→10→15→20s
        let target = (Engine.position() || 0) + dir * step;
        target = Math.max(0, Math.min(target, Math.max(0, dur - 0.25)));
        DSKControls.seek(target);
      }
      function stop() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
        if (stepTimer) { clearInterval(stepTimer); stepTimer = 0; }
      }
      btn.addEventListener("pointerdown", () => {
        if (!playlist.length) return;
        stop(); didSeek = false; accel = 0;
        holdTimer = setTimeout(() => {
          holdTimer = 0; didSeek = true;
          stepOnce(); stepTimer = setInterval(stepOnce, TICK);
          try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
        }, HOLD);
      });
      const end = () => stop();
      btn.addEventListener("pointerup", end);
      btn.addEventListener("pointercancel", end);
      btn.addEventListener("pointerleave", end);
      btn.addEventListener("click", (e) => {
        if (didSeek) { didSeek = false; e.preventDefault(); e.stopPropagation(); return; }
        shortAction();
      });
    }
    attachHoldSeek($("#btnPrev"), -1, () => { if (playlist.length) gotoPrev(); });
    attachHoldSeek($("#btnNext"), +1, () => { if (playlist.length) gotoNext(); });
    $("#btnStop").addEventListener("click", async () => {
      const wasPlaying = Engine.playing;
      // actualizar icono SIN re-notificar al servicio (evita rearrancarlo)
      $("#btnPlay").classList.remove("is-playing");
      $("#playGlyph").innerHTML = SVG_PLAY;
      document.body.classList.remove("is-playing");
      if (Engine.tapeLive && wasPlaying) {
        await Engine.pause();   // deja sonar el fade de parada de cinta
        Engine.stop();          // tras el fade, corta del todo (incl. cola de reverb)
      } else {
        Engine.stop();
      }
      try { if (window.AndroidMedia && window.AndroidMedia.stopNotification) window.AndroidMedia.stopNotification(); } catch (e) {}
    });

    /* shuffle toggle */
    $("#btnShuffle").addEventListener("click", () => {
      shuffle = !shuffle;
      $("#btnShuffle").classList.toggle("is-on", shuffle);
      if (shuffle) buildShuffleBag(true);
    });

    // repetición: off → repetir actual → repetir todo
    try { const rm = parseInt(localStorage.getItem("dsklofi.repeat") || "0", 10); setRepeat(isNaN(rm) ? 0 : rm); } catch (e) { setRepeat(0); }
    const repBtn = $("#btnRepeat");
    if (repBtn) repBtn.addEventListener("click", () => setRepeat(repeatMode + 1));

    const dice = $("#btnRnd");
    dice.addEventListener("click", () => {
      randomizeAll();
      dice.classList.remove("is-rolling");
      void dice.offsetWidth;
      dice.classList.add("is-rolling");
    });

    /* tape start/stop switch */
    $("#btnTape").classList.toggle("is-on", tapeEffect);  // reflejar estado inicial
    $("#btnTape").addEventListener("click", () => {
      tapeEffect = !tapeEffect;
      Engine.setTapeLive(tapeEffect);
      $("#btnTape").classList.toggle("is-on", tapeEffect);
    });

    /* al terminar una pista: avanzar a la siguiente si hay playlist, si no parar */
    document.addEventListener("dsk:ended", () => {
      if (endOfTrackTimer) {
        // sleep "fin de pista": parar al acabar esta canción
        endOfTrackTimer = false;
        updateTimerBadge();
        setPlayIcon(false);
        if (_eotFading) { setOutputVolumeFactor(1); _eotFading = false; }
        try { if (window.AndroidMedia && window.AndroidMedia.stopNotification) window.AndroidMedia.stopNotification(); } catch (e) {}
        return;
      }
      if (Engine.loop) { /* repetir actual: la fuente hace bucle, no llega aquí */ }
      else advanceOnEnd();
    });

    /* seek on waveform */
    const wave = $("#wave");
    let seeking = false;
    const seekTo = (e) => {
      const r = wave.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      Engine.seek(frac);
    };
    wave.addEventListener("pointerdown", (e) => {
      if (!Engine.buffer) return;
      seeking = true;
      wave.setPointerCapture(e.pointerId);
      seekTo(e);
    });
    wave.addEventListener("pointermove", (e) => { if (seeking) seekTo(e); });
    wave.addEventListener("pointerup", () => { seeking = false; });
  }

  /* ========================= RANDOMIZE ========================= */
  /* Tasteful ranges — never extreme, never touches OUTPUT volume. */
  function rr(min, max) { return min + Math.random() * (max - min); }

  function randomizeAll() {
    Engine.setSection("lofi", {
      on: true,
      tone: rr(0.30, 0.75),
      crush: rr(0.05, 0.60),
      hiss: rr(0.00, 0.55),
      crackle: rr(0.00, 0.70),
      wow: rr(0.05, 0.60)
    });
    Engine.setSection("reverb", {
      on: Math.random() < 0.7,
      mix: rr(0.10, 0.45),
      size: rr(0.20, 0.80),
      damp: rr(0.30, 0.80)
    });
    Engine.setSection("delay", {
      on: Math.random() < 0.35,
      time: rr(0.10, 0.60),
      fb: rr(0.10, 0.55),
      mix: rr(0.15, 0.35)
    });
    Engine.setSection("chorus", {
      on: Math.random() < 0.35,
      rate: rr(0.10, 0.60),
      depth: rr(0.20, 0.65),
      mix: rr(0.20, 0.55)
    });
    syncAll();
    Object.values(presetRows).forEach((r) => r.clear());
    persistParams();
  }

  /* ========================= VISUALIZERS ========================= */
  const vizC = $("#viz"), vizX = vizC.getContext("2d");
  const waveC = $("#wave"), waveX = waveC.getContext("2d");
  let vizPeaks = new Float32Array(48);

  /* ---- bobinas: rotación con aceleración/frenado gradual ---- */
  const reelEls = $$(".reel");
  let reelAngleA = 0;     // grados acumulados (bobina izquierda)
  let reelAngleB = 0;     // grados acumulados (bobina derecha)
  let reelSpeed = 0;      // grados/segundo actuales
  let lastReelT = 0;      // timestamp anterior
  const REEL_MAX = 150;   // velocidad de crucero (deg/s)

  function updateReels(now) {
    const dt = lastReelT ? Math.min((now - lastReelT) / 1000, 0.05) : 0;
    lastReelT = now;
    // objetivo: gira a tope si reproduce, 0 si no. Rampa suave (cinta).
    const target = Engine.playing ? REEL_MAX : 0;
    // aproximación exponencial: ~0.9s para arrancar/frenar del todo
    reelSpeed += (target - reelSpeed) * Math.min(dt * 3.2, 1);
    if (reelSpeed < 0.05 && target === 0) reelSpeed = 0;
    const delta = reelSpeed * dt;
    // cada bobina acumula su propio ángulo y envuelve por separado (sin saltos)
    reelAngleA = (reelAngleA + delta) % 360;
    reelAngleB = (reelAngleB + delta * 0.78) % 360;
    if (reelEls[0]) reelEls[0].style.setProperty("--reel-rot", reelAngleA.toFixed(2) + "deg");
    if (reelEls[1]) reelEls[1].style.setProperty("--reel-rot", reelAngleB.toFixed(2) + "deg");
  }

  function sizeCanvases() {
    [vizC, waveC].forEach((c) => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    });
    drawWave();
  }

  function accent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--acc").trim();
    return /^#?[0-9a-f]{6}$/i.test(v) ? v : "#00FF41";
  }
  /* versión aclarada del acento (mezcla con blanco), para la "cabeza" de Matrix */
  function accentLight(hex, t) {
    const c = hexToRgb(hex) || { r: 0, g: 255, b: 65 };
    const m = (x) => Math.round(x + (255 - x) * (t == null ? 0.6 : t));
    return "rgb(" + m(c.r) + "," + m(c.g) + "," + m(c.b) + ")";
  }

  let vizMode = 0;            // 0..13
  const VIZ_MODES = 14;
  let vizPhase = 0;          // para animaciones suaves
  const VIZ_NAMES = ["Bars", "Mirror", "Wave", "Area", "Dots", "Radial", "Matrix", "Spectrum", "Particles", "VU", "Rings", "Starfield", "Oscilloscope", "Terrain"];

  function setVizMode(m) {
    vizMode = (m + VIZ_MODES) % VIZ_MODES;
    vizPeaks = new Float32Array(48);
    try { vizX.clearRect(0, 0, vizC.width, vizC.height); } catch (e) {}
    mtxCols = null; spectroData = null; particles = null; stars = null;
    try { localStorage.setItem("dsklofi.viz", String(vizMode)); } catch (e) {}
    // reflejar selección en el modal si está abierto
    $$("#vizGrid .viz-grid__item").forEach((el, i) => el.classList.toggle("is-on", i === vizMode));
  }

  function buildVizGrid() {
    const grid = $("#vizGrid");
    if (!grid) return;
    grid.innerHTML = "";
    VIZ_NAMES.forEach((name, i) => {
      const b = document.createElement("button");
      b.className = "viz-grid__item" + (i === vizMode ? " is-on" : "");
      b.type = "button";
      b.innerHTML = '<span class="viz-grid__num">' + (i + 1) + '</span><span>' + name + '</span>';
      b.addEventListener("click", () => setVizMode(i));   // selecciona y previsualiza, sin cerrar
      grid.appendChild(b);
    });
  }

  function openVizPicker() {
    $$("#vizGrid .viz-grid__item").forEach((el, i) => el.classList.toggle("is-on", i === vizMode));
    UI.openModal("vizPickModal");
  }

  function getFreq() {
    if (Engine.analyser && Engine.playing) {
      const d = new Uint8Array(Engine.analyser.frequencyBinCount);
      Engine.analyser.getByteFrequencyData(d);
      return d;
    }
    return null;
  }
  function getWave() {
    if (Engine.analyser && Engine.playing) {
      const d = new Uint8Array(Engine.analyser.fftSize);
      Engine.analyser.getByteTimeDomainData(d);
      return d;
    }
    return null;
  }

  function drawViz() {
    const W = vizC.width, H = vizC.height;
    // Matrix (6) y espectrograma (7) acumulan su propio rastro: no limpiar
    if (vizMode !== 6 && vizMode !== 7) vizX.clearRect(0, 0, W, H);
    const acc = accent();
    vizPhase += 0.02;
    switch (vizMode) {
      case 0: vizBars(W, H, acc, false); break;
      case 1: vizBars(W, H, acc, true); break;       // espejo (centradas)
      case 2: vizLine(W, H, acc); break;             // forma de onda
      case 3: vizArea(W, H, acc); break;             // área rellena (frecuencia)
      case 4: vizDots(W, H, acc); break;             // puntos
      case 5: vizRadial(W, H, acc); break;           // radial / círculo
      case 6: vizMatrix(W, H, acc); break;           // lluvia Matrix
      case 7: vizSpectro(W, H, acc); break;          // cascada / espectrograma
      case 8: vizParticles(W, H, acc); break;        // partículas
      case 9: vizVU(W, H, acc); break;               // VU dual horizontal
      case 10: vizRings(W, H, acc); break;           // anillos concéntricos
      case 11: vizStarfield(W, H, acc); break;       // campo de estrellas
      case 12: vizScope(W, H, acc); break;           // osciloscopio XY
      case 13: vizTerrain(W, H, acc); break;         // terreno / cordillera
    }
    vizX.globalAlpha = 1;
  }

  function vizBars(W, H, acc, mirror) {
    const N = 48;
    const gap = W * 0.004;
    const bw = (W - gap * (N - 1)) / N;
    const data = getFreq();
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (data) { const idx = Math.floor(Math.pow(i / N, 1.6) * (data.length * 0.72)); v = data[idx] / 255; }
      if (v > vizPeaks[i]) vizPeaks[i] = v;
      else vizPeaks[i] = Math.max(0, vizPeaks[i] - 0.012);
      const x = i * (bw + gap);
      vizX.fillStyle = acc;
      if (mirror) {
        const h = Math.max(H * 0.01, v * H * 0.46);
        vizX.globalAlpha = 0.92;
        vizX.fillRect(x, H / 2 - h, bw, h);
        vizX.fillRect(x, H / 2, bw, h);
      } else {
        const h = Math.max(H * 0.012, v * H * 0.92);
        vizX.globalAlpha = 0.92;
        vizX.fillRect(x, H - h, bw, h);
        const ph = vizPeaks[i] * H * 0.92;
        vizX.globalAlpha = 0.55;
        vizX.fillRect(x, H - ph - H * 0.02, bw, Math.max(1.5, H * 0.008));
      }
    }
  }

  function vizLine(W, H, acc) {
    const data = getWave();
    vizX.lineWidth = Math.max(2, H * 0.02);
    vizX.strokeStyle = acc;
    vizX.globalAlpha = 0.95;
    vizX.beginPath();
    const n = data ? data.length : 64;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const v = data ? (data[i] / 128 - 1) : Math.sin(i * 0.2 + vizPhase) * 0.04;
      const y = H / 2 + v * H * 0.42;
      if (i === 0) vizX.moveTo(x, y); else vizX.lineTo(x, y);
    }
    vizX.stroke();
  }

  function vizArea(W, H, acc) {
    const data = getFreq();
    const n = 64;
    vizX.beginPath();
    vizX.moveTo(0, H);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      let v = 0;
      if (data) { const idx = Math.floor(Math.pow(i / n, 1.5) * (data.length * 0.7)); v = data[idx] / 255; }
      const y = H - Math.max(H * 0.01, v * H * 0.92);
      vizX.lineTo(x, y);
    }
    vizX.lineTo(W, H);
    vizX.closePath();
    vizX.globalAlpha = 0.35; vizX.fillStyle = acc; vizX.fill();
    vizX.globalAlpha = 0.9; vizX.lineWidth = 2; vizX.strokeStyle = acc; vizX.stroke();
  }

  function vizDots(W, H, acc) {
    const N = 40;
    const data = getFreq();
    vizX.fillStyle = acc;
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (data) { const idx = Math.floor(Math.pow(i / N, 1.6) * (data.length * 0.72)); v = data[idx] / 255; }
      const x = (i + 0.5) / N * W;
      const y = H - Math.max(H * 0.04, v * H * 0.9);
      const r = Math.max(1.5, H * 0.018 + v * H * 0.03);
      vizX.globalAlpha = 0.4 + v * 0.6;
      vizX.beginPath(); vizX.arc(x, y, r, 0, Math.PI * 2); vizX.fill();
    }
  }

  function vizRadial(W, H, acc) {
    const cx = W / 2, cy = H / 2;
    const N = 64;
    const baseR = Math.min(W, H) * 0.16;
    const data = getFreq();
    vizX.strokeStyle = acc; vizX.fillStyle = acc;
    vizX.lineWidth = Math.max(1.5, W * 0.004);
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (data) { const idx = Math.floor(Math.pow(i / N, 1.4) * (data.length * 0.6)); v = data[idx] / 255; }
      const ang = (i / N) * Math.PI * 2 + vizPhase * 0.5;
      const len = baseR + v * Math.min(W, H) * 0.3;
      vizX.globalAlpha = 0.35 + v * 0.65;
      vizX.beginPath();
      vizX.moveTo(cx + Math.cos(ang) * baseR, cy + Math.sin(ang) * baseR);
      vizX.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      vizX.stroke();
    }
    // anillo central
    vizX.globalAlpha = 0.5; vizX.lineWidth = 1.5;
    vizX.beginPath(); vizX.arc(cx, cy, baseR, 0, Math.PI * 2); vizX.stroke();
  }

  /* ---- Matrix: lluvia de caracteres reactiva al audio ---- */
  let mtxCols = null, mtxFont = 14, mtxLastW = 0;
  const MTX_CHARS = "アイウエオカキクケコサシスセソﾀﾁﾂﾃﾄ0123456789:.=*+-<>".split("");
  function vizMatrix(W, H, acc) {
    mtxFont = Math.max(11, Math.round(H / 7));
    const cols = Math.floor(W / (mtxFont * 0.8));
    if (!mtxCols || mtxLastW !== W || mtxCols.length !== cols) {
      mtxCols = new Array(cols).fill(0).map(() => Math.random() * -20);
      mtxLastW = W;
    }
    const data = getFreq();
    let energy = 0;
    if (data) { for (let i = 0; i < 32; i++) energy += data[i]; energy /= (32 * 255); }
    // estela: fondo semitransparente para dejar rastro
    vizX.fillStyle = "rgba(0,0,0,0.18)";
    vizX.fillRect(0, 0, W, H);
    vizX.font = mtxFont + "px monospace";
    vizX.textBaseline = "top";
    const speed = 0.15 + energy * 0.6;
    const rows = H / mtxFont;
    for (let i = 0; i < cols; i++) {
      const x = i * (mtxFont * 0.8) + 2;
      const yHead = mtxCols[i] * mtxFont;
      // cabeza brillante
      const ch = MTX_CHARS[(Math.random() * MTX_CHARS.length) | 0];
      vizX.globalAlpha = 0.95;
      vizX.fillStyle = accentLight(acc, 0.6);
      if (yHead >= 0 && yHead < H) vizX.fillText(ch, x, yHead);
      // cola que se desvanece
      for (let k = 1; k < 6; k++) {
        const yy = yHead - k * mtxFont;
        if (yy < 0 || yy > H) continue;
        vizX.globalAlpha = (0.5 - k * 0.08) * (0.5 + energy);
        vizX.fillStyle = acc;
        vizX.fillText(MTX_CHARS[(Math.random() * MTX_CHARS.length) | 0], x, yy);
      }
      mtxCols[i] += speed;
      if (mtxCols[i] * mtxFont > H && Math.random() > 0.975) mtxCols[i] = Math.random() * -10;
    }
    vizX.globalAlpha = 1;
  }

  /* ---- Espectrograma: cascada de frecuencias desplazándose ---- */
  let spectroData = null, spectroW = 0, spectroH = 0;
  function vizSpectro(W, H, acc) {
    const data = getFreq();
    if (!spectroData || spectroW !== W || spectroH !== H) {
      spectroData = vizX.createImageData(W, H);
      spectroW = W; spectroH = H;
    }
    // desplazar la imagen 2px a la izquierda
    const img = vizX.getImageData(2, 0, W - 2, H);
    vizX.putImageData(img, 0, 0);
    // columna nueva a la derecha
    const col = vizX.createImageData(2, H);
    const accRGB = hexToRgb(acc) || { r: 0, g: 255, b: 65 };
    for (let y = 0; y < H; y++) {
      let v = 0;
      if (data) { const idx = Math.floor(Math.pow(1 - y / H, 1.5) * (data.length * 0.7)); v = data[idx] / 255; }
      const o = y * 8;
      col.data[o] = accRGB.r * v; col.data[o + 1] = accRGB.g * v; col.data[o + 2] = accRGB.b * v; col.data[o + 3] = 255 * Math.min(1, v * 1.4);
      col.data[o + 4] = accRGB.r * v; col.data[o + 5] = accRGB.g * v; col.data[o + 6] = accRGB.b * v; col.data[o + 7] = 255 * Math.min(1, v * 1.4);
    }
    vizX.putImageData(col, W - 2, 0);
  }

  /* ---- Partículas: puntos que reaccionan al volumen ---- */
  let particles = null;
  function vizParticles(W, H, acc) {
    if (!particles) {
      particles = new Array(70).fill(0).map(() => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        r: 1 + Math.random() * 2
      }));
    }
    const data = getFreq();
    let energy = 0;
    if (data) { for (let i = 0; i < 24; i++) energy += data[i]; energy /= (24 * 255); }
    vizX.fillStyle = acc;
    const boost = 1 + energy * 5;
    particles.forEach((p) => {
      p.x += p.vx * boost; p.y += p.vy * boost;
      if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
      vizX.globalAlpha = 0.3 + energy * 0.7;
      vizX.beginPath();
      vizX.arc(p.x, p.y, p.r * (0.6 + energy * 1.8), 0, Math.PI * 2);
      vizX.fill();
    });
    vizX.globalAlpha = 1;
  }

  /* ---- VU dual: barras horizontales espejo desde el centro ---- */
  function vizVU(W, H, acc) {
    const N = 20;
    const data = getFreq();
    const cy = H / 2;
    const bh = (H - (N - 1) * 2) / N / 2;
    vizX.fillStyle = acc;
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (data) { const idx = Math.floor(Math.pow(i / N, 1.5) * (data.length * 0.7)); v = data[idx] / 255; }
      const w = Math.max(W * 0.01, v * W * 0.48);
      const yT = cy - (i + 1) * (bh + 2);
      const yB = cy + i * (bh + 2);
      vizX.globalAlpha = 0.85;
      vizX.fillRect(W / 2 - w, yT, w, bh);
      vizX.fillRect(W / 2, yT, w, bh);
      vizX.fillRect(W / 2 - w, yB, w, bh);
      vizX.fillRect(W / 2, yB, w, bh);
    }
    vizX.globalAlpha = 1;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  /* ---- Anillos concéntricos que laten con los graves ---- */
  function vizRings(W, H, acc) {
    const cx = W / 2, cy = H / 2;
    const data = getFreq();
    const maxR = Math.min(W, H) * 0.48;
    const N = 7;
    vizX.strokeStyle = acc;
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (data) { const idx = Math.floor((i / N) * (data.length * 0.5)); v = data[idx] / 255; }
      const r = (i / N) * maxR + v * maxR * 0.18 + (Math.sin(vizPhase * 2 + i) * 3);
      vizX.globalAlpha = 0.25 + v * 0.7;
      vizX.lineWidth = Math.max(1.5, v * 6);
      vizX.beginPath(); vizX.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2); vizX.stroke();
    }
    vizX.globalAlpha = 1;
  }

  /* ---- Campo de estrellas: vuelan hacia el espectador con la energía ---- */
  let stars = null;
  function vizStarfield(W, H, acc) {
    const cx = W / 2, cy = H / 2;
    const fov = Math.min(W, H) * 0.9;
    if (!stars) {
      // distribuir en profundidad uniforme para que no aparezcan de golpe
      stars = new Array(140).fill(0).map(() => ({
        x: (Math.random() * 2 - 1),
        y: (Math.random() * 2 - 1),
        z: 0.15 + Math.random() * 0.85   // 0.15..1 (normalizado)
      }));
    }
    const data = getFreq();
    let energy = 0;
    if (data) { for (let i = 0; i < 24; i++) energy += data[i]; energy /= (24 * 255); }
    const sp = (0.004 + energy * 0.025);
    vizX.fillStyle = acc;
    stars.forEach((s) => {
      s.z -= sp;
      if (s.z <= 0.06) {
        // reaparece al fondo con nueva posición
        s.z = 1; s.x = (Math.random() * 2 - 1); s.y = (Math.random() * 2 - 1);
      }
      const k = fov / (s.z * fov);   // factor de proyección ∝ 1/z
      const px = cx + s.x * (cx / s.z);
      const py = cy + s.y * (cy / s.z);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) return;
      const depth = 1 - s.z;                 // 0 lejos … 1 cerca
      const r = 0.4 + depth * depth * 2.6;
      vizX.globalAlpha = Math.min(1, 0.15 + depth);
      vizX.beginPath(); vizX.arc(px, py, r, 0, Math.PI * 2); vizX.fill();
    });
    vizX.globalAlpha = 1;
  }

  /* ---- Osciloscopio XY (Lissajous) a partir de la onda ---- */
  function vizScope(W, H, acc) {
    const data = getWave();
    if (!data) return;
    const cx = W / 2, cy = H / 2;
    const amp = Math.min(W, H) * 0.42;
    vizX.strokeStyle = acc; vizX.globalAlpha = 0.9;
    vizX.lineWidth = Math.max(1.5, W * 0.004);
    vizX.beginPath();
    const n = data.length;
    for (let i = 0; i < n - 1; i++) {
      const x = cx + ((data[i] / 128) - 1) * amp;
      const y = cy + ((data[(i + 24) % n] / 128) - 1) * amp;   // desfase → figura
      if (i === 0) vizX.moveTo(x, y); else vizX.lineTo(x, y);
    }
    vizX.stroke();
    vizX.globalAlpha = 1;
  }

  /* ---- Terreno: cordillera de frecuencias con relleno degradado ---- */
  function vizTerrain(W, H, acc) {
    const data = getFreq();
    const N = 80;
    const accRGB = hexToRgb(acc) || { r: 0, g: 255, b: 65 };
    // dos capas para dar profundidad
    for (let layer = 0; layer < 2; layer++) {
      const yBase = H * (0.55 + layer * 0.22);
      const scale = (1 - layer * 0.35);
      vizX.beginPath();
      vizX.moveTo(0, H);
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * W;
        let v = 0;
        if (data) { const idx = Math.floor(Math.pow(i / N, 1.3) * (data.length * 0.6)); v = data[idx] / 255; }
        const y = yBase - v * H * 0.5 * scale - Math.sin(i * 0.4 + vizPhase) * 2;
        vizX.lineTo(x, y);
      }
      vizX.lineTo(W, H); vizX.closePath();
      const a = layer === 0 ? 0.85 : 0.45;
      vizX.fillStyle = "rgba(" + accRGB.r + "," + accRGB.g + "," + accRGB.b + "," + a + ")";
      vizX.fill();
    }
  }

  function drawWave() {
    const W = waveC.width, H = waveC.height;
    waveX.clearRect(0, 0, W, H);
    if (!peaks) return;
    const frac = Engine.duration ? Engine.position() / Engine.duration : 0;
    const N = peaks.length;
    const gap = W * 0.0022;
    const bw = (W - gap * (N - 1)) / N;
    const acc = accent();
    const mutedCol = getComputedStyle(document.documentElement).getPropertyValue("--color-text-faint").trim();
    for (let i = 0; i < N; i++) {
      const h = Math.max(H * 0.06, peaks[i] * H * 0.9);
      const x = i * (bw + gap);
      waveX.fillStyle = i / N <= frac ? acc : mutedCol;
      waveX.globalAlpha = i / N <= frac ? 1 : 0.45;
      waveX.fillRect(x, (H - h) / 2, bw, h);
    }
    waveX.globalAlpha = 1;
    /* playhead */
    const px = frac * W;
    waveX.fillStyle = acc;
    waveX.fillRect(px - 1, 0, 2, H);
  }

  // Aplica un factor 0..1 sobre el volumen de salida (1 = volumen normal del
  // usuario), vía el nodo de fade dedicado del Engine. `secsLeft`, si se pasa,
  // permite programar una rampa que llega EXACTAMENTE a 0 al final (evita el
  // corte brusco que deja setTargetAtTime, que es asintótico y nunca llega a 0).
  function setOutputVolumeFactor(k, secsLeft) {
    try { Engine.setFadeFactor(k, secsLeft); } catch (e) {}
  }

  let _eotFading = false; // evita reiniciar el fade en cada frame
  function tickEndOfTrackFade() {
    if (!endOfTrackTimer || !Engine.playing) {
      if (_eotFading) { setOutputVolumeFactor(1); _eotFading = false; }
      return;
    }
    const dur = curDurationOverride > 0 ? curDurationOverride : (Engine.duration || 0);
    if (!dur) return;
    const left = dur - Engine.position();
    if (left <= FADE_SECS) {
      _eotFading = true;
      const lin = Math.max(0, Math.min(1, left / FADE_SECS)); // 1→0
      // curva tipo "equal power": cae más despacio al principio y se precipita
      // al final de forma suave (sin el corte brusco de una rampa lineal).
      const k = lin * lin;
      setOutputVolumeFactor(k, left);
    } else if (_eotFading) {
      setOutputVolumeFactor(1);
      _eotFading = false;
    }
  }

  let _lastQSave = 0;
  let _lastMediaPush = 0;
  function raf(now) {
    const t = now || performance.now();
    // ¿se ven realmente los visuales del reproductor? Si la pantalla está
    // oculta o hay un modal encima (letras, karaoke, biblioteca…), NO dibujamos:
    // así liberamos el hilo principal para el audio y evitamos artefactos.
    // La reproducción, la notificación y el guardado siguen funcionando igual.
    const visuals = !document.hidden && !document.body.classList.contains("has-modal");
    if (visuals) { updateReels(t); drawViz(); }
    // refrescar la posición de la notificación cada ~4s mientras suena
    if (Engine.playing && t - _lastMediaPush > 4000) { _lastMediaPush = t; try { pushMediaState(true); } catch (e) {} }
    tickEndOfTrackFade();
    if (playerOnlyMode) {
      // modo reproductor: no hay buffer; actualizar tiempo y barra de seek
      if (visuals) {
        $("#timeCur").textContent = fmt.time(Engine.position());
        if (typeof window.__poUpdate === "function") window.__poUpdate();
      }
      if (Engine.playing && t - _lastQSave > 3000) { _lastQSave = t; saveQueue(); }
    } else if (Engine.buffer) {
      if (visuals) {
        drawWave();
        $("#timeCur").textContent = fmt.time(Engine.position());
      }
      // persistir posición de la cola cada ~3s mientras suena
      if (Engine.playing && t - _lastQSave > 3000) { _lastQSave = t; saveQueue(); }
    }
    requestAnimationFrame(raf);
  }

  /* ========================= EXPORT ========================= */
  let exportFormat = "mp3";
  let exportAbort = false;
  let exporting = false;

  // base64 (sin prefijo data:) → Uint8Array
  function b64ToBytes(b64) {
    try {
      const clean = b64.indexOf(",") !== -1 ? b64.slice(b64.indexOf(",") + 1) : b64;
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  async function doExport() {
    if (!Engine.buffer) return;
    const name = sanitize($("#exportName").value || "dsk-lofi");
    let format = exportFormat;
    if (format === "mp3" && !Encoder.mp3Ready) {
      UI.toast(I18n.t("ex_mp3_missing"), "warn");
      format = "wav";
    }

    exportAbort = false;
    exporting = true;
    UI.openModal("exportModal");
    const bar = $("#exportBar"), pct = $("#exportPct"), status = $("#exportStatus");
    const cancelBtn = $("#exportCancel");
    if (cancelBtn) {
      cancelBtn.hidden = false;
      cancelBtn.disabled = false;
      cancelBtn.textContent = I18n.t("ex_cancel");
      cancelBtn.classList.remove("is-armed");
      if (cancelBtn._disarm) cancelBtn._disarm();
    }
    const setP = (v) => { bar.style.width = Math.round(v * 100) + "%"; pct.textContent = Math.round(v * 100) + "%"; };
    status.textContent = I18n.t("ex_rendering");
    setP(0);
    try {
      const rendered = await Engine.render((v) => setP(format === "mp3" ? v * 0.6 : v), { tapeEffect }, () => exportAbort);
      if (exportAbort) throw new Error("__cancel__");
      let blob;
      if (format === "mp3") {
        status.textContent = I18n.t("ex_encoding");
        await new Promise((r) => setTimeout(r, 60));
        blob = await Encoder.mp3(rendered, 128, (v) => setP(0.6 + v * 0.4), () => exportAbort);
        // incrustar carátula (ID3 original o miniatura YouTube) + título/artista
        try {
          const titleEl = $("#trackName .deck__name-txt");
          const artistEl = $("#trackArtist");
          const meta = {
            title: titleEl ? (titleEl.textContent || "").trim() : "",
            artist: artistEl ? (artistEl.textContent || "").trim() : ""
          };
          if (currentCoverB64) {
            meta.coverBytes = b64ToBytes(currentCoverB64);
            meta.coverMime = "image/jpeg";
          }
          if (meta.coverBytes || meta.title || meta.artist) {
            blob = await Encoder.wrapMp3WithTag(blob, meta);
          }
        } catch (e) { /* si falla el tag, se exporta el MP3 sin carátula */ }
      } else {
        blob = Encoder.wav(rendered);
      }
      if (exportAbort) throw new Error("__cancel__");
      setP(1);
      const mode = await Bridge.save(name + "." + format, blob);
      exporting = false;
      UI.closeModal("exportModal");
      UI.toast(I18n.t(mode === "bridge" ? "ex_done_bridge" : "ex_done_web"), "ok");
    } catch (err) {
      exporting = false;
      UI.closeModal("exportModal");
      if (err && err.message === "__cancel__") {
        UI.toast(I18n.t("ex_cancelled"));
      } else {
        console.warn("export failed", err);
        UI.error(I18n.t("ex_fail"));
      }
    } finally {
      if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.textContent = I18n.t("ex_cancel"); cancelBtn.classList.remove("is-armed"); }
    }
  }

  function bindExportCancel() {
    const btn = $("#exportCancel");
    if (!btn) return;
    let confirmArmed = false;
    let armTimer = null;
    function disarm() {
      confirmArmed = false;
      btn.classList.remove("is-armed");
      btn.textContent = I18n.t("ex_cancel");
      if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    }
    btn.addEventListener("click", () => {
      if (!exporting) return;
      if (!confirmArmed) {
        // primer tap: pedir confirmación inline
        confirmArmed = true;
        btn.classList.add("is-armed");
        btn.textContent = I18n.t("ex_cancel_sure");
        armTimer = setTimeout(disarm, 3000);  // se desarma solo a los 3s
        return;
      }
      // segundo tap: cancelar de verdad
      disarm();
      exportAbort = true;
      btn.disabled = true;
      btn.textContent = I18n.t("ex_cancelling");
    });
    // exponer disarm para reiniciar al abrir el modal
    btn._disarm = disarm;
  }

  /* ========================= SLEEP TIMER ========================= */
  let timerEnd = 0;        // timestamp (ms) cuando expira
  let timerRAF = null;
  let endOfTrackTimer = false;   // parar al acabar la pista actual
  const FADE_SECS = 15;    // fade-out final

  function updateTimerBadge() {
    const badge = $("#timerBadge");
    if (endOfTrackTimer) {
      badge.hidden = false; badge.textContent = "▮";
      $("#btnTimer").classList.add("is-on");
    } else if (!timerEnd) {
      badge.hidden = true;
      $("#btnTimer").classList.remove("is-on");
    }
  }

  function startEndOfTrack() {
    cancelTimer(true);
    endOfTrackTimer = true;
    updateTimerBadge();
    $("#timerCancel").hidden = false;
    UI.toast(I18n.t("tm_endtrack_on"));
  }

  function startTimer(minutes) {
    cancelTimer(true);
    timerEnd = Date.now() + minutes * 60000;
    $("#timerBadge").hidden = false;
    $("#btnTimer").classList.add("is-on");
    $("#timerCancel").hidden = false;
    UI.toast(I18n.t("tm_on") + " · " + minutes + " min");
    tickTimer();
  }

  function cancelTimer(silent) {
    if (timerRAF) { cancelAnimationFrame(timerRAF); timerRAF = null; }
    timerEnd = 0;
    endOfTrackTimer = false;
    $("#timerBadge").hidden = true;
    $("#btnTimer").classList.remove("is-on");
    $("#timerCancel").hidden = true;
    // restaurar volumen por si quedó a media bajada (timer por minutos o fin de pista)
    if (_eotFading) { setOutputVolumeFactor(1); _eotFading = false; }
    try { Engine.resetFade(); } catch (e) {}   // reset instantáneo (no rampa lenta)
    if (Engine.chain) {
      try {
        Engine.setParam("output", "volume", Engine.params.output.volume);
      } catch (e) {}
    }
    if (!silent) UI.toast(I18n.t("tm_off"));
  }

  function tickTimer() {
    if (!timerEnd) return;
    const left = timerEnd - Date.now();
    const badge = $("#timerBadge");
    if (left <= 0) {
      // fin: pausar y limpiar
      cancelTimer(true);
      (async () => { setPlayIcon(false); await Engine.pause(); })();
      UI.toast(I18n.t("tm_done"));
      return;
    }
    // badge mm:ss
    const s = Math.ceil(left / 1000);
    badge.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    // fade-out suave en los últimos FADE_SECS
    if (left <= FADE_SECS * 1000 && Engine.playing) {
      const k = Math.max(0, left / (FADE_SECS * 1000)); // 1→0
      _eotFading = true;
      setOutputVolumeFactor(k);
    }
    timerRAF = requestAnimationFrame(tickTimer);
  }

  function buildTimer() {
    $("#btnTimer").addEventListener("click", () => UI.openModal("timerModal"));
    $$("#timerOpts .chip").forEach((b) => {
      b.addEventListener("click", () => {
        startTimer(parseInt(b.getAttribute("data-min"), 10));
        UI.closeModal("timerModal");
      });
    });
    $("#timerCustomGo").addEventListener("click", () => {
      const m = parseInt($("#timerCustom").value, 10);
      if (m > 0) { startTimer(m); UI.closeModal("timerModal"); }
    });
    $("#timerEndTrack").addEventListener("click", () => { startEndOfTrack(); UI.closeModal("timerModal"); });
    $("#timerCancel").addEventListener("click", () => { cancelTimer(); UI.closeModal("timerModal"); });
  }

  /* ========================= GENERAL PRESETS ========================= */
  const GP_LS = "dsklofi.genpresets";

  // Presets de fábrica (combinan todas las secciones). Marcados factory:true.
  const GP_FACTORY = [
    { id: "f_dusty", name: "Dusty Tape", factory: true, params: {
      lofi: { on: true, tone: 0.50, crush: 0.22, hiss: 0.45, crackle: 0.30, wow: 0.45 },
      reverb: { on: true, mix: 0.22, size: 0.45, damp: 0.55 },
      delay: { on: false, time: 0.30, fb: 0.35, mix: 0.25 },
      chorus: { on: false, rate: 0.25, depth: 0.40, mix: 0.40 },
      output: { volume: 1.0 } } },
    { id: "f_vinyl", name: "Old Vinyl", factory: true, params: {
      lofi: { on: true, tone: 0.42, crush: 0.30, hiss: 0.18, crackle: 0.70, wow: 0.28 },
      reverb: { on: true, mix: 0.18, size: 0.30, damp: 0.60 },
      delay: { on: false, time: 0.30, fb: 0.35, mix: 0.25 },
      chorus: { on: false, rate: 0.25, depth: 0.40, mix: 0.40 },
      output: { volume: 1.0 } } },
    { id: "f_dream", name: "Dreamy", factory: true, params: {
      lofi: { on: true, tone: 0.55, crush: 0.18, hiss: 0.25, crackle: 0.15, wow: 0.55 },
      reverb: { on: true, mix: 0.38, size: 0.65, damp: 0.40 },
      delay: { on: true, time: 0.35, fb: 0.40, mix: 0.28 },
      chorus: { on: true, rate: 0.25, depth: 0.50, mix: 0.45 },
      output: { volume: 1.0 } } },
    { id: "f_radio", name: "AM Radio", factory: true, params: {
      lofi: { on: true, tone: 0.26, crush: 0.55, hiss: 0.35, crackle: 0.20, wow: 0.15 },
      reverb: { on: false, mix: 0.18, size: 0.30, damp: 0.60 },
      delay: { on: false, time: 0.30, fb: 0.35, mix: 0.25 },
      chorus: { on: false, rate: 0.25, depth: 0.40, mix: 0.40 },
      output: { volume: 1.0 } } },
    { id: "f_clean", name: "Subtle Warmth", factory: true, params: {
      lofi: { on: true, tone: 0.68, crush: 0.10, hiss: 0.12, crackle: 0.10, wow: 0.15 },
      reverb: { on: true, mix: 0.14, size: 0.35, damp: 0.55 },
      delay: { on: false, time: 0.30, fb: 0.35, mix: 0.25 },
      chorus: { on: false, rate: 0.25, depth: 0.40, mix: 0.40 },
      output: { volume: 1.0 } } },
    { id: "f_slowedrev", name: "Slowed + Reverb", factory: true, speed: 0.85, params: {
      lofi: { on: true, tone: 0.52, crush: 0.12, hiss: 0.20, crackle: 0.15, wow: 0.40 },
      reverb: { on: true, mix: 0.50, size: 0.85, damp: 0.35 },
      delay: { on: true, time: 0.38, fb: 0.30, mix: 0.22 },
      chorus: { on: false, rate: 0.25, depth: 0.40, mix: 0.40 },
      output: { volume: 1.0 } } }
  ];

  let gpUser = [];        // presets del usuario
  let gpCurrentId = null;

  function gpLoad() {
    try {
      const raw = localStorage.getItem(GP_LS);
      gpUser = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(gpUser)) gpUser = [];
    } catch (e) { gpUser = []; }
  }
  function gpPersist() {
    try { localStorage.setItem(GP_LS, JSON.stringify(gpUser)); } catch (e) {}
  }
  function gpAll() { return GP_FACTORY.concat(gpUser); }

  function gpApply(preset) {
    Object.keys(preset.params).forEach((sec) => {
      Engine.setSection(sec, Object.assign({}, preset.params[sec]));
    });
    syncAll();
    Object.values(presetRows).forEach((r) => r.clear());
    persistParams();
    // velocidad del preset (p.ej. Slowed + Reverb → 0.85); si no define, restaura 1×
    const spd = typeof preset.speed === "number" ? preset.speed : 1;
    Engine.setSpeed(spd);
    if (typeof window.__applySpeedLabel === "function") window.__applySpeedLabel();
    try { localStorage.setItem("dsklofi.speed", String(Engine.speed)); } catch (e) {}
    gpCurrentId = preset.id;
    $("#gpComboLabel").textContent = preset.name;
  }

  function gpSnapshot() {
    const p = Engine.params;
    return {
      lofi: Object.assign({}, p.lofi),
      reverb: Object.assign({}, p.reverb),
      delay: Object.assign({}, p.delay),
      chorus: Object.assign({}, p.chorus),
      output: Object.assign({}, p.output)
    };
  }

  function renderCombo() {
    const menu = $("#gpComboMenu");
    menu.innerHTML = "";
    const groups = [
      { label: I18n.t("gp_factory"), items: GP_FACTORY },
      { label: I18n.t("gp_user"), items: gpUser }
    ];
    groups.forEach((g) => {
      if (!g.items.length) return;
      const head = document.createElement("div");
      head.className = "combo__group"; head.textContent = g.label;
      menu.appendChild(head);
      g.items.forEach((p) => {
        const it = document.createElement("button");
        it.className = "combo__item" + (p.id === gpCurrentId ? " combo__item--active" : "");
        it.type = "button";
        it.textContent = p.name;
        it.addEventListener("click", () => {
          gpApply(p);
          menu.hidden = true;
          renderCombo();
        });
        menu.appendChild(it);
      });
    });
  }

  function renderGpList() {
    const host = $("#gpList");
    host.innerHTML = "";
    if (!gpUser.length) {
      const e = document.createElement("p");
      e.className = "opt__sub"; e.textContent = I18n.t("gp_empty");
      host.appendChild(e); return;
    }
    gpUser.forEach((p) => {
      const row = document.createElement("div");
      row.className = "gp-row";
      row.innerHTML = '<span class="gp-row__name"></span>' +
        '<button class="gp-row__apply chip" type="button" data-i18n="gp_applied"></button>' +
        '<button class="gp-row__del icon-btn" type="button"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg></button>';
      row.querySelector(".gp-row__name").textContent = p.name;
      const applyBtn = row.querySelector(".gp-row__apply");
      applyBtn.textContent = I18n.t("gp_applied").toUpperCase();
      applyBtn.addEventListener("click", () => { gpApply(p); renderCombo(); });
      row.querySelector(".gp-row__del").addEventListener("click", async () => {
        const ok = await UI.confirm({ title: I18n.t("gp_del_title"), message: I18n.t("gp_del_msg") + " · " + p.name, danger: true });
        if (!ok) return;
        gpUser = gpUser.filter((x) => x.id !== p.id);
        if (gpCurrentId === p.id) { gpCurrentId = null; $("#gpComboLabel").textContent = I18n.t("gp_select"); }
        gpPersist(); renderGpList(); renderCombo();
        UI.toast(I18n.t("gp_deleted"));
      });
      host.appendChild(row);
    });
  }

  function buildGenPresets() {
    gpLoad();
    renderCombo();

    /* combo abrir/cerrar */
    const menu = $("#gpComboMenu");
    $("#gpComboBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      $("#gpCombo").classList.toggle("combo--open", !menu.hidden);
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#gpCombo")) { menu.hidden = true; $("#gpCombo").classList.remove("combo--open"); }
    });

    /* admin modal */
    $("#gpAdmin").addEventListener("click", () => { renderGpList(); UI.openModal("gpModal"); });

    $("#gpSave").addEventListener("click", () => {
      const name = ($("#gpName").value || "").trim();
      if (!name) return;
      const id = "u_" + Date.now().toString(36);
      gpUser.push({ id, name, params: gpSnapshot() });
      gpPersist();
      $("#gpName").value = "";
      gpCurrentId = id;
      $("#gpComboLabel").textContent = name;
      renderGpList(); renderCombo();
      UI.toast(I18n.t("gp_saved") + " · " + name);
    });

    /* export JSON */
    $("#gpExport").addEventListener("click", async () => {
      const data = JSON.stringify({ app: "DSKLoFi", type: "genpresets", v: 1, presets: gpUser }, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      await Bridge.save("DSKLoFi_presets.json", blob);
      UI.toast(I18n.t("gp_exported"));
    });

    /* import JSON */
    $("#gpImport").addEventListener("click", () => $("#gpImportFile").click());
    $("#gpImportFile").addEventListener("change", async () => {
      const f = $("#gpImportFile").files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const obj = JSON.parse(txt);
        const incoming = Array.isArray(obj) ? obj : (obj.presets || []);
        let added = 0;
        incoming.forEach((p) => {
          if (p && p.name && p.params) {
            gpUser.push({ id: "u_" + Date.now().toString(36) + "_" + (added++), name: p.name, params: p.params });
          }
        });
        gpPersist(); renderGpList(); renderCombo();
        UI.toast(I18n.t("gp_imported") + " · " + added);
      } catch (e) {
        UI.error(I18n.t("gp_import_fail"));
      } finally {
        $("#gpImportFile").value = "";
      }
    });
  }

  /* ========================= OPTIONS ========================= */
  function buildOptions() {
    /* language segmented — built from I18n.available so new langs auto-appear */
    const langHost = $("#langSeg");
    langHost.innerHTML = "";
    I18n.available.forEach((l) => {
      const b = document.createElement("button");
      b.className = "seg__item";
      b.setAttribute("data-val", l.code);
      b.textContent = l.code.toUpperCase();
      langHost.appendChild(b);
    });
    const langSeg = UI.segmented(langHost, (val) => {
      I18n.set(val);
      refreshDynamicText();
      UI.toast(I18n.t("lang_changed"));
    });
    langSeg.set(I18n.lang);

    /* selector de tema: 4 oscuros (izquierda) + 4 claros (derecha) */
    const themeHost = $("#themeSeg");
    themeHost.innerHTML = "";
    const colDark = document.createElement("div");
    const colLight = document.createElement("div");
    colDark.className = "theme-col";
    colLight.className = "theme-col";
    function markTheme(id) {
      themeHost.querySelectorAll(".theme-sw").forEach((s) =>
        s.classList.toggle("theme-sw--active", s.getAttribute("data-val") === id)
      );
    }
    THEMES.forEach((th) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "theme-sw";
      b.setAttribute("data-val", th.id);
      b.style.setProperty("--sw", th.swatch);
      b.innerHTML = '<span class="theme-sw__dot"></span>';
      b.addEventListener("click", () => {
        setTheme(th.id);
        markTheme(th.id);
        UI.toast(I18n.t("theme_changed"));
      });
      (th.dark ? colDark : colLight).appendChild(b);
    });
    themeHost.appendChild(colDark);
    themeHost.appendChild(colLight);
    markTheme(document.documentElement.getAttribute("data-theme") || "dark");

    /* pantalla de carga on/off (solo afecta al próximo arranque) */
    const swSplash = $("#swSplash");
    if (swSplash) {
      const on = localStorage.getItem("dsklofi.splash") !== "0";
      swSplash.setAttribute("aria-checked", on ? "true" : "false");
      swSplash.addEventListener("click", () => {
        const next = swSplash.getAttribute("aria-checked") !== "true";
        swSplash.setAttribute("aria-checked", next ? "true" : "false");
        try { localStorage.setItem("dsklofi.splash", next ? "1" : "0"); } catch (e) {}
      });
    }

    /* auto-ganancia / normalización por pista */
    const swNorm = $("#swNorm");
    const normSeg = $("#normSeg");
    const normRow = $("#normLevelRow");
    let normEnabled = true, normLevel = "normal";
    try { normEnabled = localStorage.getItem("dsklofi.norm") !== "0"; } catch (e) {}
    try { normLevel = localStorage.getItem("dsklofi.normlevel") || "normal"; } catch (e) {}
    function syncNormUI() {
      if (swNorm) swNorm.setAttribute("aria-checked", normEnabled ? "true" : "false");
      if (normRow) normRow.style.display = normEnabled ? "" : "none";
    }
    const normSegCtl = normSeg ? UI.segmented(normSeg, (v) => {
      normLevel = v;
      try { localStorage.setItem("dsklofi.normlevel", v); } catch (e) {}
      Engine.setNorm(normEnabled, normLevel);
    }) : null;
    if (normSegCtl) normSegCtl.set(normLevel);
    if (swNorm) swNorm.addEventListener("click", () => {
      normEnabled = swNorm.getAttribute("aria-checked") !== "true";
      try { localStorage.setItem("dsklofi.norm", normEnabled ? "1" : "0"); } catch (e) {}
      syncNormUI();
      Engine.setNorm(normEnabled, normLevel);
    });
    syncNormUI();
    Engine.setNorm(normEnabled, normLevel);

    /* ---- ganancia de salida (-6..+6 dB, persistente) ---- */
    const optGain = $("#optGain"), optGainVal = $("#optGainVal");
    const fmtDb = (v) => { const d = (v || 0) * 6; return (d > 0 ? "+" : "") + d.toFixed(1) + " dB"; };
    let outGainVal = 0;
    try { const s = localStorage.getItem("dsklofi.outgain"); if (s !== null) outGainVal = parseFloat(s) || 0; } catch (e) {}
    outGainVal = Math.max(-1, Math.min(1, outGainVal));
    Engine.params.output.gain = outGainVal;
    try { Engine.setOutGain(outGainVal); } catch (e) {}
    if (optGain) {
      optGain.value = outGainVal;
      if (optGainVal) optGainVal.textContent = fmtDb(outGainVal);
      optGain.addEventListener("input", () => {
        outGainVal = parseFloat(optGain.value) || 0;
        if (optGainVal) optGainVal.textContent = fmtDb(outGainVal);
        try { Engine.setOutGain(outGainVal); } catch (e) {}
        try { localStorage.setItem("dsklofi.outgain", String(outGainVal)); } catch (e) {}
      });
      // doble toque en la etiqueta → reset a 0 dB
      const gainRow = optGain.closest(".opt");
      const lbl = gainRow ? gainRow.querySelector(".param__label") : null;
      if (lbl) {
        let lastTap = 0;
        lbl.addEventListener("click", () => {
          const now = Date.now();
          if (now - lastTap < 350) {
            outGainVal = 0; optGain.value = 0;
            if (optGainVal) optGainVal.textContent = fmtDb(0);
            try { Engine.setOutGain(0); } catch (e) {}
            try { localStorage.setItem("dsklofi.outgain", "0"); } catch (e) {}
          }
          lastTap = now;
        });
      }
    }

    /* ---- modo solo reproductor (audio nativo, instantáneo, sin FX) ---- */
    Engine.setNativeMode(false, nativeAudio);   // registra el <audio> para el visualizador
    const swPlayer = $("#swPlayerOnly");
    // restaura los efectos lofi a sus valores por defecto (sin tocar tema/idioma).
    // Se aplica en cada transición de modo reproductor (entrar y salir).
    function resetEffectsToDefaults() {
      try { Engine.resetAll(); } catch (e) {}
      try { Engine.setSpeed(1); } catch (e) {}
      if (typeof window.__applySpeedLabel === "function") window.__applySpeedLabel();
      try { localStorage.removeItem("dsklofi.speed"); } catch (e) {}
      // tape in/out activo por defecto
      tapeEffect = true;
      try { Engine.setTapeLive(true); } catch (e) {}
      const t = $("#btnTape"); if (t) t.classList.toggle("is-on", true);
      try { syncAll(); } catch (e) {}
      try { Object.values(presetRows).forEach((r) => r.clear()); } catch (e) {}
      try { persistParams(); } catch (e) {}
    }

    function applyPlayerOnly(on, persist) {
          playerOnlyMode = !!on;
          Engine.nativeMode = !!on;
          document.body.classList.toggle("player-only", !!on);
          syncMetaRows();   // ajusta las dos filas de info según el modo (altura constante)
          if (swPlayer) swPlayer.setAttribute("aria-checked", on ? "true" : "false");
          const seekBar = $("#poSeek"); if (seekBar) seekBar.hidden = !on;

          if (on) {
            // al entrar: registrar audio nativo y desactivar el tape (sin efectos)
            Engine.setNativeMode(true, nativeAudio);
            try { Engine.setTapeLive(false); } catch (e) {}
            const t = $("#btnTape"); if (t) t.classList.remove("is-on");
          } else {
            // al salir: restaurar los efectos a sus valores por defecto
            resetEffectsToDefaults();
          }
          if (persist) { try { localStorage.setItem("dsklofi.playeronly", on ? "1" : "0"); } catch (e) {} }
        }
        applyPlayerOnlyRef = applyPlayerOnly;

        if (swPlayer) {
          swPlayer.addEventListener("click", () => {
            requestMode(swPlayer.getAttribute("aria-checked") !== "true");
          });
        }
    // Modo reproductor por DEFECTO: activo salvo que el usuario lo haya apagado ("0").
    try { if (localStorage.getItem("dsklofi.playeronly") !== "0") applyPlayerOnly(true, false); } catch (e) {}
    syncModeUI();

    // eventos del <audio> nativo → sincronizar UI
    nativeAudio.addEventListener("play", () => { keepAliveOn(); if (playerOnlyMode) setPlayIcon(true); });
    nativeAudio.addEventListener("pause", () => { if (playerOnlyMode && !nativeAudio.ended) setPlayIcon(false); });
    nativeAudio.addEventListener("ended", () => {
      if (!playerOnlyMode) return;
      if (endOfTrackTimer) { endOfTrackTimer = false; updateTimerBadge(); setPlayIcon(false); if (_eotFading) { setOutputVolumeFactor(1); _eotFading = false; } return; }
      if (Engine.loop) { nativeAudio.currentTime = 0; nativeAudio.play(); }
      else advanceOnEnd();
    });
    // El stream/archivo de la pista actual ya no existe o no se puede leer
    // (p. ej. se borró desde el explorador de archivos). Saltar y limpiar.
    nativeAudio.addEventListener("error", () => {
      if (!playerOnlyMode) return;
      if (!nativeAudio.src) return;
      const track = playlist[plIndex];
      console.warn("native audio error", nativeAudio.error);
      $("#loaderBusy").hidden = true; $("#waveBusy").hidden = true; $("#loaderIdle").hidden = false;
      if (!checkStorageOnFail(track)) skipMissingTrack(track, true);
    });

    // barra de seek del modo reproductor
    const poRange = $("#poSeekRange");
    let poSeeking = false;
    if (poRange) {
      poRange.addEventListener("input", () => {
        poSeeking = true;
        const dur = Engine.duration || 0;
        if (dur > 0) $("#poTimeCur").textContent = fmt.time((poRange.value / 1000) * dur);
      });
      poRange.addEventListener("change", () => {
        const frac = poRange.value / 1000;
        Engine.seek(frac);
        poSeeking = false;
      });
    }
    // exponer para el raf
    window.__poUpdate = function () {
      if (!playerOnlyMode || poSeeking || !poRange) return;
      const dur = Engine.duration || 0;
      const pos = Engine.position();
      if (dur > 0) {
        poRange.value = Math.round((pos / dur) * 1000);
        $("#poTimeCur").textContent = fmt.time(pos);
        $("#poTimeTotal").textContent = fmt.time(dur);
        $("#timeCur").textContent = fmt.time(pos);
        $("#timeTotal").textContent = fmt.time(dur);
      }
    };

    $("#btnRestore").addEventListener("click", async () => {
      const ok = await UI.confirm({
        title: I18n.t("cf_restore_title"),
        message: I18n.t("cf_restore_msg"),
        danger: true
      });
      if (!ok) return;
      /* factory: params, theme, language, velocidad, modo completo */
      const wasPlayerOnly = playerOnlyMode;
      const wasPlaying = Engine.playing;
      const cur = playlist[plIndex];
      const pos = Engine.position();
      if (wasPlayerOnly) { try { Engine.stop(); } catch (e) {} applyPlayerOnly(false, true); }
      localStorage.removeItem("dsklofi.playeronly");
      Engine.resetAll();
      Engine.setSpeed(1);
      if (typeof window.__applySpeedLabel === "function") window.__applySpeedLabel();
      localStorage.removeItem(LS.params);
      localStorage.removeItem(LS.theme);
      localStorage.removeItem("dsklofi.lang");
      localStorage.removeItem("dsklofi.speed");
      localStorage.removeItem("dsklofi.splash");
      localStorage.removeItem("dsklofi.norm");
      localStorage.removeItem("dsklofi.normlevel");
      localStorage.removeItem("dsklofi.outgain");
      { const sn = $("#swNorm"); if (sn) sn.setAttribute("aria-checked", "true"); }
      { const nr = $("#normLevelRow"); if (nr) nr.style.display = ""; }
      { const ns = $("#normSeg"); if (ns) UI.$$(".seg__item", ns).forEach((b) => b.classList.toggle("seg__item--active", b.getAttribute("data-val") === "normal")); }
      try { Engine.setNorm(true, "normal"); } catch (e) {}
      try { Engine.setOutGain(0); } catch (e) {}
      { const og = $("#optGain"); if (og) og.value = 0; const ogv = $("#optGainVal"); if (ogv) ogv.textContent = "0.0 dB"; }
      { const ss = $("#swSplash"); if (ss) ss.setAttribute("aria-checked", "true"); }
      setTheme("dark", false);
      I18n.set(I18n.detect(), false);
      markTheme("dark");
      syncModeUI();
      langSeg.set(I18n.lang);
      syncAll();
      Object.values(presetRows).forEach((r) => r.clear());
      refreshDynamicText();
      // si estaba en modo reproductor, recargar la pista con el motor completo
      if (wasPlayerOnly && cur) { pendingRestorePos = pos > 1 ? pos : 0; await loadFile(cur, wasPlaying); }
      UI.toast(I18n.t("restored"), "ok");
    });

    $("#bridgeMode").textContent = Bridge.native ? "ANDROID · /DSKlofi" : "WEB · PWA";
    $("#appVersion").textContent = "v" + getAppVersion();

    initUpdateChecker();
  }

  /* ---------------------- DSK•LoFi — Auto-update ---------------------- */
  const native_update = () =>
    typeof window.DSKUpdate !== "undefined" &&
    typeof window.DSKUpdate.checkUpdate === "function";

  let upReqSeq = 0;
  const upPending = {};

  function installUpdateCallbacks() {
    if (!native_update() || window.DSKUpdate.__cbReady) return;
    window.DSKUpdate.__result = function (reqId, json) {
      const p = upPending[reqId]; if (!p) return; delete upPending[reqId];
      let obj = {}; try { obj = JSON.parse(json) || {}; } catch (e) {}
      p.resolve(obj);
    };
    window.DSKUpdate.__error = function (reqId, code) {
      const p = upPending[reqId]; if (!p) return; delete upPending[reqId];
      p.reject(code || "network");
    };
    window.DSKUpdate.__installError = function (msg) {
      const st = $("#updateStatus");
      if (st) st.textContent = "Error al instalar: " + (msg || "");
    };
    window.DSKUpdate.__cbReady = true;
  }

  function checkUpdate() {
    return new Promise((resolve, reject) => {
      installUpdateCallbacks();
      if (!native_update()) { reject("unsupported"); return; }
      const reqId = "up" + (++upReqSeq) + "_" + Date.now();
      const to = setTimeout(() => { if (upPending[reqId]) { delete upPending[reqId]; reject("timeout"); } }, 15000);
      upPending[reqId] = {
        resolve: (v) => { clearTimeout(to); resolve(v); },
        reject: (e) => { clearTimeout(to); reject(e); }
      };
      try { window.DSKUpdate.checkUpdate(reqId); }
      catch (e) { clearTimeout(to); delete upPending[reqId]; reject("network"); }
    });
  }

  function initUpdateChecker() {
    const btn = $("#btnCheckUpdate");
    const st = $("#updateStatus");
    if (!btn) return;

    if (!native_update()) {
      btn.style.display = "none";
      return;
    }

    async function runCheck(showIdle) {
      if (st) st.textContent = "Buscando actualizaciones…";
      try {
        const r = await checkUpdate();
        if (r.update) {
          if (st) {
            st.innerHTML = "";
            const span = document.createElement("span");
            span.textContent = "Nueva versión disponible: " + (r.versionName || "");
            const dl = document.createElement("button");
            dl.className = "btn btn--accent btn--block";
            dl.style.marginTop = "8px";
            dl.textContent = "Descargar e instalar";
            dl.addEventListener("click", () => {
              if (st) st.textContent = "Descargando… revisa la notificación.";
              window.DSKUpdate.downloadAndInstall(r.url);
            });
            st.appendChild(span);
            st.appendChild(dl);
          }
          if (window.UI) UI.toast("Actualización disponible: " + (r.versionName || ""), null, 6000);
        } else if (st) {
          st.textContent = showIdle ? "Tienes la última versión." : "";
        }
      } catch (e) {
        if (st && showIdle) st.textContent = "No se pudo comprobar.";
      }
    }

    btn.addEventListener("click", () => runCheck(true));
    // chequeo silencioso al arrancar
    runCheck(false);
  }


  /* text that isn't covered by data-i18n (state-dependent) */
  function refreshDynamicText() {
    Object.keys(SECTIONS).forEach((sec) => setSwitch(sec, Engine.params[sec].on));
    setPlayIcon(Engine.playing);
    $("#exportHint").textContent = I18n.t(Bridge.native ? "ex_hint_bridge" : "ex_hint_web");
  }

  /* ========================= INIT ========================= */
  /* funde la pantalla de carga cuando el layout ya está estable */
  const SPLASH_MIN_MS = 900;    // mínimo en pantalla para que el propio splash no parpadee
  let splashHidden = false;
  // __dskSplashHolds / __dskSplashHold ya se definieron en el shim inline de index.html.
  // Aquí definimos la liberación real, que oculta el splash si ya no quedan holds.
  window.__dskSplashRelease = function () {
    window.__dskSplashHolds = Math.max(0, (window.__dskSplashHolds || 0) - 1);
    if (window.__dskSplashHolds === 0 && window.__dskSplashWantHide) hideSplash();
  };
  function hideSplash() {
    if (splashHidden) return;
    if ((window.__dskSplashHolds || 0) > 0) { window.__dskSplashWantHide = true; return; }
    splashHidden = true;
    const s = document.getElementById("splash");
    if (!s) return;
    s.classList.add("is-done");
    setTimeout(() => { s.style.display = "none"; }, 500);
  }
  function scheduleSplashHide() {
    const fire = () => {
      const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
      setTimeout(() => {
        requestAnimationFrame(() => requestAnimationFrame(hideSplash));
      }, wait);
    };
    if (document.readyState === "complete") fire();
    else window.addEventListener("load", fire, { once: true });
  }

  async function init() {
    setTheme(localStorage.getItem(LS.theme) || "dark", false);
    I18n.init();

    restoreParams();
    Engine.params.output.volume = 1.0;   // salida siempre al 100% (se controla con el volumen del dispositivo)
    buildSections();
    UI.initCollapsibles();
    I18n.apply(); /* translate dynamically built labels/chips */
    bindTransport();
    buildOptions();
    buildTimer();
    buildGenPresets();
    syncAll();
    refreshDynamicText();
    renderPlaylist();   // mini-lista visible desde el arranque (vacía al principio)

    /* loader interactions */
    $("#loaderIdle").addEventListener("click", pickAudio);
    const btnLoadFolder = $("#btnLoadFolder");
    if (btnLoadFolder) btnLoadFolder.addEventListener("click", (e) => { e.stopPropagation(); pickFolder(); });
    if (dirInput) dirInput.addEventListener("change", () => {
      if (dirInput.files.length) setPlaylist(dirInput.files, 0);
      dirInput.value = "";
    });

    /* sin menú contextual / pulsación larga (excepto en campos de texto) */
    document.addEventListener("contextmenu", (e) => {
      if (!e.target.closest("input, textarea, [contenteditable]")) e.preventDefault();
    });
    $("#btnChange").addEventListener("click", pickAudio);
    $("#btnGoExport").addEventListener("click", () => {
      const exp = $('[data-plain="export"]');
      if (exp) exp.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) setPlaylist(fileInput.files, 0);
    });

    ["dragover", "drop"].forEach((ev) =>
      document.addEventListener(ev, (e) => e.preventDefault())
    );
    document.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        setPlaylist(e.dataTransfer.files, 0);
      }
    });

    /* options modal */
    $("#btnOptions").addEventListener("click", () => UI.openModal("optionsModal"));

    /* enlaces externos: en la app abrir en navegador externo (target=_blank no
       funciona en el WebView sin onCreateWindow); en web, comportamiento normal */
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="http"]');
      if (!a) return;
      if (window.AndroidFileManager && typeof window.AndroidFileManager.openExternal === "function") {
        e.preventDefault();
        window.AndroidFileManager.openExternal(a.href);
      }
    });

    /* export */
    const fmtSeg = UI.segmented($("#formatSeg"), (v) => { exportFormat = v; });
    fmtSeg.set("mp3");
    $("#btnExport").addEventListener("click", doExport);
    bindExportCancel();
    Encoder.probeMp3().then((ok) => {
      $("#fmtMp3").hidden = !ok;
      if (!ok) { exportFormat = "wav"; fmtSeg.set("wav"); }
    });

    /* engine boot on first touch (autoplay policy) */
    const boot = () => { Engine.init().then(() => Engine.setTapeLive(tapeEffect)); document.removeEventListener("pointerdown", boot); };
    document.addEventListener("pointerdown", boot, { once: true });

    sizeCanvases();
    window.addEventListener("resize", sizeCanvases);
    requestAnimationFrame(raf);

    /* PWA */
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    /* ============================ ARTWORK (CARÁTULA) ============================ */
    initArtwork();

    /* ============================ EDITOR DE ETIQUETAS ID3 ============================ */
    initTagEditor();

    /* ============================ SHAZAM (AudD) ============================ */
    initShazam();

    /* fundir la pantalla de carga: tras 'load' y un mínimo en pantalla */
    scheduleSplashHide();
  }

  /* ---- editor de etiquetas ID3 (título/artista/álbum/track + carátula) ----
     Reutiliza shrinkCover() para reescalar la carátula nueva. Lectura/escritura
     reales por el bridge nativo (readTags/writeTags por URI SAF). */
  function initTagEditor() {
    const modal = $("#tagEditModal");
    if (!modal) return;
    const elImg = $("#tagCoverImg"), elNone = $("#tagCoverNone");
    const fTitle = $("#tagFTitle"), fArtist = $("#tagFArtist"), fAlbum = $("#tagFAlbum"), fTrack = $("#tagFTrack");
    const pick = $("#tagCoverPick"), clear = $("#tagCoverClear"), input = $("#tagCoverInput"), save = $("#tagSave");
    const coverSave = $("#tagCoverSave");

    let curUri = "";
    let coverState = "";     // "" = no tocar · " " = quitar · base64 = nueva
    let shownCover = "";     // carátula actualmente visible (para "guardar")
    const pendingCb = {};
    let seq = 0, busy = false;

    function hasFn(m) { return typeof window.DSKBridge !== "undefined" && typeof window.DSKBridge[m] === "function"; }
    function stripExtName(s) { return (s || "").replace(/\.[^.]+$/, ""); }

    function installCb() {
      if (typeof window.DSKBridge === "undefined") return;
      if (!window.DSKBridge.__tagsRead) window.DSKBridge.__tagsRead = function (reqId, json) {
        const p = pendingCb[reqId]; if (!p) return; delete pendingCb[reqId];
        let o = {}; try { o = JSON.parse(json) || {}; } catch (e) {} p(o);
      };
      if (!window.DSKBridge.__tagsWritten) window.DSKBridge.__tagsWritten = function (reqId, ok) {
        const p = pendingCb[reqId]; if (!p) return; delete pendingCb[reqId];
        p(ok === true || ok === "true");
      };
    }

    function showCover(b64) {
      shownCover = b64 || "";
      if (b64) { elImg.src = "data:image/jpeg;base64," + b64; elImg.hidden = false; elNone.hidden = true; }
      else { elImg.removeAttribute("src"); elImg.hidden = true; elNone.hidden = false; }
      if (coverSave) coverSave.hidden = !b64;
    }

    function open(item) {
      if (!item || !item.uri || item.ytId) { UI.toast(I18n.t("tag_local_only")); return; }
      if (!hasFn("readTags") || !hasFn("writeTags")) { UI.toast(I18n.t("tag_app_only")); return; }
      curUri = item.uri; coverState = ""; busy = false;
      fTitle.value = stripExtName(item.name || ""); fArtist.value = ""; fAlbum.value = ""; fTrack.value = "";
      showCover("");
      UI.openModal("tagEditModal");
      installCb();
      const reqId = "tr" + (++seq) + "_" + Date.now();
      const mine = curUri;
      pendingCb[reqId] = (o) => {
        if (curUri !== mine) return;
        if (o.title) fTitle.value = o.title;
        if (o.artist) fArtist.value = o.artist;
        if (o.album) fAlbum.value = o.album;
        if (o.track) fTrack.value = o.track;
        showCover(o.cover || "");
      };
      try { window.DSKBridge.readTags(curUri, reqId); } catch (e) { delete pendingCb[reqId]; }
    }

    if (pick) pick.addEventListener("click", () => input && input.click());
    // guardar/descargar la carátula visible (la del archivo) antes de sustituirla
    if (coverSave) coverSave.addEventListener("click", () => {
      if (!shownCover) return;
      const base = (fArtist.value.trim() + " " + fTitle.value.trim()).trim() || "cover";
      const filename = "cover_" + base.replace(/[^a-z0-9]/gi, "_").slice(0, 40) + ".jpg";
      if (hasFn("saveImage")) window.DSKBridge.saveImage(shownCover, filename); // toast nativo
      else {
        const a = document.createElement("a");
        a.href = "data:image/jpeg;base64," + shownCover;
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        UI.toast(I18n.t("aw_saved"));
      }
    });
    if (input) input.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        const b64 = await shrinkCover(new Uint8Array(buf));
        if (b64) { coverState = b64; showCover(b64); }
        else UI.toast(I18n.t("err_decode"));
      } catch (err) {}
    });
    if (clear) clear.addEventListener("click", async () => {
      if (!shownCover) { coverState = " "; showCover(""); return; }
      const ok = (UI && UI.confirm)
        ? await UI.confirm({ title: I18n.t("tag_cover_remove"), message: I18n.t("tag_cover_remove_ask"), confirmLabel: I18n.t("tag_cover_remove"), cancelLabel: I18n.t("cancel"), danger: true })
        : true;
      if (ok) { coverState = " "; showCover(""); }
    });

    if (save) save.addEventListener("click", () => {
      if (busy || !curUri) return;
      busy = true;
      installCb();
      const reqId = "tw" + (++seq) + "_" + Date.now();
      const to = setTimeout(() => {
        if (pendingCb[reqId]) { delete pendingCb[reqId]; busy = false; UI.toast(I18n.t("tag_save_fail"), "danger"); }
      }, 30000);
      pendingCb[reqId] = (ok) => {
        clearTimeout(to); busy = false;
        if (ok) {
          UI.toast(I18n.t("tag_saved"));
          UI.closeModal("tagEditModal");
          if (window.DSKLib && DSKLib.refresh) DSKLib.refresh();
        } else UI.toast(I18n.t("tag_save_fail"), "danger");
      };
      try {
        window.DSKBridge.writeTags(curUri, fTitle.value.trim(), fArtist.value.trim(),
          fAlbum.value.trim(), fTrack.value.trim(), coverState, reqId);
      } catch (e) { clearTimeout(to); busy = false; UI.toast(I18n.t("tag_save_fail"), "danger"); }
    });

    window.DSKTagEditor = { open };
  }

  /* ---- modal de carátula a pantalla completa ---- */
  function initArtwork() {
    const btn = $("#btnArtwork"); if (!btn) return;
    const modal = $("#artworkModal");
    const awImg = $("#awImg");
    const awBg  = $("#awBg");
    const awClose = $("#awClose");
    const awSave  = $("#awSave");
    const awShare = $("#awShare");
    if (!modal || !awImg) return;

    function hasBridgeFn(m) { return typeof window.DSKBridge !== "undefined" && typeof window.DSKBridge[m] === "function"; }

    function openArtwork() {
      if (!currentCoverB64) return;
      const src = "data:image/jpeg;base64," + currentCoverB64;
      awImg.src = src;
      awBg.style.backgroundImage = "url(" + src + ")";
      modal.setAttribute("aria-hidden", "false");
      window.__dskBackStack.push(closeArtwork);
    }
    function closeArtwork() {
      modal.setAttribute("aria-hidden", "true");
      awImg.src = "";
      awBg.style.backgroundImage = "";
      // quitar del backstack si cierra con X
      const stack = window.__dskBackStack;
      const idx = stack.lastIndexOf(closeArtwork);
      if (idx !== -1) stack.splice(idx, 1);
    }

    btn.addEventListener("click", openArtwork);
    awClose.addEventListener("click", closeArtwork);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeArtwork(); });

    // Guardar
    awSave.addEventListener("click", () => {
      if (!currentCoverB64) return;
      const trackTitle = ($("#trackName .deck__name-txt") || {}).textContent || "cover";
      const filename = "cover_" + trackTitle.replace(/[^a-z0-9]/gi, "_").slice(0, 40) + ".jpg";
      if (hasBridgeFn("saveImage")) {
        // el bridge muestra su propio toast nativo (éxito/fallo)
        window.DSKBridge.saveImage(currentCoverB64, filename);
      } else {
        // web fallback
        const a = document.createElement("a");
        a.href = "data:image/jpeg;base64," + currentCoverB64;
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        UI.toast(I18n.t("aw_saved"));
      }
    });

    // Compartir
    awShare.addEventListener("click", () => {
      if (!currentCoverB64) return;
      const trackTitle = ($("#trackName .deck__name-txt") || {}).textContent || "cover";
      const filename = "cover_" + trackTitle.replace(/[^a-z0-9]/gi, "_").slice(0, 40) + ".jpg";
      if (hasBridgeFn("shareImage")) {
        window.DSKBridge.shareImage(currentCoverB64, filename);
      } else if (navigator.share) {
        // web share API (móviles modernos en browser)
        fetch("data:image/jpeg;base64," + currentCoverB64)
          .then((r) => r.blob())
          .then((blob) => {
            const file = new File([blob], filename, { type: "image/jpeg" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              navigator.share({ files: [file] }).catch(() => {});
            } else {
              navigator.share({ title: trackTitle, url: window.location.href }).catch(() => {});
            }
          }).catch(() => {});
      }
    });

    // ocultar opciones no disponibles en entorno sin bridge
    // (en browser puro el <a download> y Web Share API cubren el caso)
  }

  /* ---- modal de supresión de voz ---- */
  const VOX_LS = "dsklofi.voxparams";
  const VOX_DEFAULTS = { amount: 1.0, low: 150, high: 7000 };
  const VOX_PRESETS = {
    soft:   { amount: 0.6, low: 220, high: 5000 },
    medium: { amount: 0.85, low: 150, high: 7000 },
    strong: { amount: 1.0, low: 100, high: 9000 }
  };

  function loadVoxParams() {
    try { return Object.assign({}, VOX_DEFAULTS, JSON.parse(localStorage.getItem(VOX_LS)) || {}); }
    catch (e) { return Object.assign({}, VOX_DEFAULTS); }
  }
  function saveVoxParams(p) { try { localStorage.setItem(VOX_LS, JSON.stringify(p)); } catch (e) {} }

  function openVoiceModal() {
    // al abrir por long-press, activar la supresión si estaba apagada
    try { if (window.Engine && !Engine.karaokeOn && Engine.setKaraoke) Engine.setKaraoke(true); } catch (e) {}
    syncVoxModalUI();
    UI.openModal("voiceModal");
  }

  function syncVoxModalUI() {
    const a = $("#voxAmount"), lo = $("#voxLow"), hi = $("#voxHigh");
    if (!a) return;
    const p = {
      amount: window.Engine ? Engine.karaokeAmount : VOX_DEFAULTS.amount,
      low:    window.Engine ? Engine.karaokeLow  : VOX_DEFAULTS.low,
      high:   window.Engine ? Engine.karaokeHigh : VOX_DEFAULTS.high
    };
    a.value = p.amount; lo.value = p.low; hi.value = p.high;
    $("#voxAmountVal").textContent = Math.round(p.amount * 100) + "%";
    $("#voxLowVal").textContent = Math.round(p.low) + " Hz";
    $("#voxHighVal").textContent = Math.round(p.high) + " Hz";
    // marcar el preset activo si coincide
    $$("#voxPresets .chip").forEach((c) => {
      const pr = VOX_PRESETS[c.getAttribute("data-voxpreset")];
      const match = pr && Math.abs(pr.amount - p.amount) < 0.001 && pr.low === p.low && pr.high === p.high;
      c.classList.toggle("chip--active", !!match);
    });
  }

  function applyVoxParams(p, persist) {
    if (window.Engine && Engine.setKaraokeParams) Engine.setKaraokeParams(p);
    if (persist !== false) {
      saveVoxParams({
        amount: window.Engine ? Engine.karaokeAmount : p.amount,
        low:    window.Engine ? Engine.karaokeLow  : p.low,
        high:   window.Engine ? Engine.karaokeHigh : p.high
      });
    }
    syncVoxModalUI();
  }

  function initVoiceModal() {
    const a = $("#voxAmount"), lo = $("#voxLow"), hi = $("#voxHigh");
    if (!a) return;
    // restaurar parámetros guardados al iniciar
    const saved = loadVoxParams();
    if (window.Engine && Engine.setKaraokeParams) Engine.setKaraokeParams(saved);

    a.addEventListener("input", () => {
      $("#voxAmountVal").textContent = Math.round(parseFloat(a.value) * 100) + "%";
      applyVoxParams({ amount: parseFloat(a.value) });
    });
    lo.addEventListener("input", () => {
      $("#voxLowVal").textContent = Math.round(parseFloat(lo.value)) + " Hz";
      applyVoxParams({ low: parseFloat(lo.value) });
    });
    hi.addEventListener("input", () => {
      $("#voxHighVal").textContent = Math.round(parseFloat(hi.value)) + " Hz";
      applyVoxParams({ high: parseFloat(hi.value) });
    });
    $$("#voxPresets .chip").forEach((c) => c.addEventListener("click", () => {
      const pr = VOX_PRESETS[c.getAttribute("data-voxpreset")];
      if (pr) applyVoxParams(Object.assign({}, pr));
    }));
    const reset = $("#voxReset");
    if (reset) reset.addEventListener("click", () => applyVoxParams(Object.assign({}, VOX_DEFAULTS)));
  }

  /* ---- reconocimiento de canciones via AudD.io ---- */
  function initShazam() {
    const AUDD_LS = "dsklofi.audd_token";
    const btn = $("#btnShazam");
    if (!btn) return;

    const elListening = $("#shListening");
    const elSearching = $("#shSearching");
    const elResult = $("#shResult");
    const elError = $("#shError");
    const elErrorMsg = $("#shErrorMsg");

    const tokenInput = $("#auddToken");
    const tokenSaveBtn = $("#auddTokenSave");
    if (tokenInput) {
      try { tokenInput.value = localStorage.getItem(AUDD_LS) || ""; } catch (e) {}
    }
    if (tokenSaveBtn) tokenSaveBtn.addEventListener("click", () => {
      const v = (tokenInput.value || "").trim();
      try { localStorage.setItem(AUDD_LS, v); } catch (e) {}
      UI.toast(I18n.t("sh_token_saved"));
    });

    function getToken() {
      try { return (localStorage.getItem(AUDD_LS) || "").trim(); } catch (e) { return ""; }
    }

    function showState(name) {
      [elListening, elSearching, elResult, elError].forEach((el) => { if (el) el.hidden = true; });
      const map = { listening: elListening, searching: elSearching, result: elResult, error: elError };
      if (map[name]) map[name].hidden = false;
    }

    let lastResult = null;
    let mediaStream = null;
    let mediaRecorder = null;

    btn.addEventListener("click", () => {
      const token = getToken();
      if (!token) {
        UI.toast(I18n.t("sh_no_token"), "warn");
        UI.openModal("optionsModal");
        return;
      }
      lastResult = null;
      showState("listening");
      UI.openModal("shazamModal");
      startListening(token);
    });

    function stopStream() {
      if (mediaStream) {
        try { mediaStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
        mediaStream = null;
      }
      mediaRecorder = null;
    }

    async function startListening(token) {
      let chunks = [];
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        showState("error");
        elErrorMsg.textContent = I18n.t("sh_no_mic");
        return;
      }
      let mime = "audio/webm";
      if (window.MediaRecorder && !MediaRecorder.isTypeSupported(mime)) {
        mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      }
      try {
        mediaRecorder = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
      } catch (e) {
        mediaRecorder = new MediaRecorder(mediaStream);
      }
      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        const mt = mediaRecorder.mimeType || "audio/webm";
        stopStream();
        const blob = new Blob(chunks, { type: mt });
        recognize(blob, token);
      };
      mediaRecorder.start();
      const countdownEl = $("#shCountdown");
      let secsLeft = 6;
      if (countdownEl) countdownEl.textContent = secsLeft;
      const countdownTimer = setInterval(() => {
        secsLeft--;
        if (countdownEl) countdownEl.textContent = Math.max(secsLeft, 0);
        if (secsLeft <= 0) clearInterval(countdownTimer);
      }, 1000);
      setTimeout(() => {
        clearInterval(countdownTimer);
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      }, 6000);
    }

    async function recognize(blob, token) {
      showState("searching");
      try {
        const fd = new FormData();
        fd.append("api_token", token);
        fd.append("file", blob, "sample.webm");
        fd.append("return", "apple_music,spotify");
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch("https://api.audd.io/", { method: "POST", body: fd, signal: ctrl.signal });
        clearTimeout(to);
        const data = await res.json();
        if (data && data.status === "success" && data.result) {
          showResult(data.result);
        } else {
          showState("error");
          elErrorMsg.textContent = I18n.t("sh_notfound");
        }
      } catch (e) {
        showState("error");
        elErrorMsg.textContent = I18n.t("sh_error_generic");
      }
    }

    function showResult(r) {
      lastResult = r;
      const title = r.title || "";
      const artist = r.artist || "";
      let cover = "";
      try {
        cover = (r.apple_music && r.apple_music.artwork && r.apple_music.artwork.url) ||
                (r.spotify && r.spotify.album && r.spotify.album.images && r.spotify.album.images[0] && r.spotify.album.images[0].url) || "";
        if (cover) cover = cover.replace("{w}", "300").replace("{h}", "300");
      } catch (e) {}
      $("#shTitle").textContent = title;
      $("#shArtist").textContent = artist;
      const img = $("#shCover");
      if (cover) { img.src = cover; img.style.display = ""; } else { img.removeAttribute("src"); img.style.display = "none"; }
      showState("result");
    }

    $("#shRetry").addEventListener("click", () => {
      const token = getToken();
      if (!token) { UI.openModal("optionsModal"); return; }
      showState("listening");
      startListening(token);
    });

    $("#shYoutube").addEventListener("click", () => {
      if (!lastResult) return;
      const q = ((lastResult.artist ? lastResult.artist + " " : "") + (lastResult.title || "")).trim();
      UI.closeModal("shazamModal");
      openPlFs();
      const goOnline = () => {
        const tabOnline = $("#libTabOnline");
        if (tabOnline) tabOnline.click();
        const input = $("#ytSearch");
        if (input) {
          input.value = q;
          const go = $("#ytGo");
          if (go) go.click();
        }
      };
      requestAnimationFrame(goOnline);
    });

    $("#shShare").addEventListener("click", () => {
      if (!lastResult) return;
      const text = (I18n.t("sh_share_text") + ": " + (lastResult.artist ? lastResult.artist + " - " : "") + (lastResult.title || "")).trim();
      if (window.DSKBridge && DSKBridge.shareText) {
        try { DSKBridge.shareText(text); return; } catch (e) {}
      }
      if (navigator.share) {
        navigator.share({ text }).catch(() => {});
        return;
      }
      if (window.DSKBridge && DSKBridge.copyToClipboard) {
        try { DSKBridge.copyToClipboard(text); UI.toast(I18n.t("copied")); return; } catch (e) {}
      }
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy"); ta.remove();
        UI.toast(I18n.t("copied"));
      } catch (e) {}
    });

    document.querySelectorAll('#shazamModal [data-close="shazamModal"]').forEach((el) => {
      el.addEventListener("click", stopStream);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();